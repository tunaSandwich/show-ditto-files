const HangModel = rootRequire('/models/Hang');
const HangMessageModel = rootRequire('/models/HangMessage');
const UserHangDataModel = rootRequire('/models/UserHangData');
const UserModel = rootRequire('/models/User');
const UserFriendDataModel = rootRequire('/models/UserFriendData');

const userAuthorize = rootRequire('/middlewares/users/authorize');
const Joi = require('joi');
const analytics = rootRequire('/setup/analytics');

const { getThreads } = rootRequire('/libs/queries');
const { sendAlert } = rootRequire('/libs/alerts');
const { Op } = Sequelize;

const {
  hangReplyMessageSchema,
  hangMessageSchema,
  hangThreadsSchema,
  userBaseSchema,
  idSchema,
} = rootRequire('/libs/schemas');

const {
  formatToUserBase,
  updateThreadData,
  formatMessages,
  updateThreads,
  createMessage,
  asyncHandler,
  json,
} = rootRequire('/libs/helpers');

const router = express.Router({ mergeParams: true });

// POST - Send a message in the specified hang
router.post('/', userAuthorize);
router.post('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangId: idSchema.required(),
    text: Joi.string().allow('').max(10000).required(),
    dedupingId: Joi.string().uuid().required(),
    sentAt: Joi.date().timestamp().iso().min('4-1-2019').required(),
    attachmentIds: Joi.array().min(1).max(12).items(idSchema).optional(),
    embedIds: Joi.array().min(1).max(12).items(idSchema).optional(),
    replyToMessageId: idSchema.optional(),
  });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId, dedupingId, sentAt, replyToMessageId } = body;

  const userHangDataQuery = { where: { userId: user.id, hangId } };

  const [
    hang,
    dupe,
    userHangData,
  ] = await Promise.all([
    HangModel.findByPk(hangId),
    HangMessageModel.unscoped().findOne({ where: { dedupingId } }),
    UserHangDataModel.findOne(userHangDataQuery),
  ]);

  if (!hang) return response.respond(404, 'Hang not found');
  if (!userHangData) return response.respond(403, 'Has not joined');
  if (dupe) return response.respond(409, 'Deduping id must be unique');

  if (userHangData.rsvp !== 'joined') {
    return response.respond(403, 'Not in hang');
  }

  user.userHangData = userHangData;

  const ufd = await UserFriendDataModel.unscoped().findOne({
    where: {
      userId: user.id,
      friendUserId: hang.authorId,
    },
  });

  if (replyToMessageId) {
    const rootMessage = await HangMessageModel.findByPk(replyToMessageId);
    if (!rootMessage) return response.respond(404, 'Message not found');

    const author = await UserModel.findByPk(rootMessage.userId);
    if (!author) return response.respond(500, 'No message author');

    if (rootMessage.replyToMessageId) {
      return response.respond(403, 'Cannot reply to a reply');
    }

    await Promise.all([
      userHangData.update({ lastReadAt: sentAt }),
      updateThreadData({
        replyToMessageId,
        rootMessage,
        user,
        repliedAt: sentAt,
        hangId,
      }),
    ]);

    const message = await createMessage(user, body);

    const value = validate(message, hangReplyMessageSchema);

    await Promise.all([
      sendReplyAlerts({ user, hang, rootMessage, author, resp: value }),
      analytics.track({
        userId: user.id,
        event: user.id === hang.authorId ?
          'Hang Messages Sent - Author' :
          'Hang Messages Sent - Joiner',
        properties: {
          hangId: hang.id,
          friendshipId: ufd ? ufd.friendshipId : null,
          message: value,
        },
      }),
    ]);

    return response.respond(201, value);
  }

  const message = await createMessage(user, body);

  await Promise.all([
    userHangData.update({ lastReadAt: sentAt }),
    hang.update({ lastMessageId: message.id, lastMessageAt: message.sentAt }),
  ]);

  const resp = message;
  resp.replies = [];

  const value = validate(resp, hangMessageSchema);

  await Promise.all([
    sendAlerts({ user, hang, resp: value }),
    analytics.track({
      userId: user.id,
      event: user.id === hang.authorId ?
        'Hang Messages Sent - Author' :
        'Hang Messages Sent - Joiner',
      properties: {
        hangId: hang.id,
        friendshipId: ufd ? ufd.friendshipId : null,
        message: value,
      },
    }),
  ]);

  return response.respond(201, value);
}));

// PATCH - Update the text of a hang message
router.patch('/', userAuthorize);
router.patch('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangMessageId: idSchema.required(),
    text: Joi.string().min(1).max(10000).required(),
  });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangMessageId, text } = body;

  const message = await HangMessageModel.unscoped().findByPk(hangMessageId);

  if (!message)
    return response.respond(404, 'Message not found');

  if (message.userId !== user.id)
    return response.respond(403, 'Not author');

  const hang = await HangModel.unscoped().findByPk(message.hangId);

  if (!hang)
    return response.respond(404, 'Hang not found');

  // TODO: boolean isEdited true
  await message.update({ text });

  const scoped = HangMessageModel.scope('withReactions');
  const scopedMessage = await scoped.findByPk(message.id);

  const data = {
    sender: formatToUserBase(user),
    hangMessage: scopedMessage.toJSON(),
  };

  if (!scopedMessage.replyToMessageId) {
    const query = {
      where: { replyToMessageId: scopedMessage.id },
      order: [ [ 'sentAt', 'DESC' ] ],
    };

    const replies = await HangMessageModel.scope('withReactions').findAll(query);
    data.hangMessage.replies = json(replies);
  }

  const userHangDataQuery = { where: { userId: user.id, hangId: hang.id } };
  const userHangData = await UserHangDataModel.findOne(userHangDataQuery);
  await userHangData.update({ lastReadAt: scopedMessage.sentAt });

  const respSchema = scopedMessage.replyToMessageId
    ? hangReplyMessageSchema
    : hangMessageSchema;

  const dataSchema = Joi.object({
    sender: userBaseSchema.required(),
    hangMessage: respSchema.required(),
  });

  const value = validate(data, dataSchema);

  const alert = {
    sender: formatToUserBase(user),
    type: value.hangMessage.replyToMessageId
      ? 'HANG_MESSAGE_REPLY_UPDATE'
      : 'HANG_MESSAGE_UPDATE',
    push: null,
    data: value,
  };

  (env === 'local')
    ? await hang.notifyHangUsers(alert)
    : hang.notifyHangUsers(alert);

  return response.respond(204);
}));

// GET - Retrieve messages for the specified hang
router.get('/', userAuthorize);
router.get('/', asyncHandler(async (request, response) => {
  const { user } = request;

  const reqSchema = Joi.object({
    hangId: Joi.number().integer().min(1).required(),
    upperbound: Joi.date().timestamp().iso().min('4-1-2019')
      .optional(),
  });

  const respSchema = Joi.object({
    hangMessages: Joi.array().max(50).items(hangMessageSchema).required(),
    threads: hangThreadsSchema.required(),
  });

  const reqError = reqSchema.validate(request.query).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const hangId = parseInt(request.query.hangId);
  const upperbound = request.query.upperbound;

  const userHangQuery = { where: { userId: user.id, hangId: hangId } };

  const [
    hang,
    userHangData,
  ] = await Promise.all([
    HangModel.findByPk(hangId),
    UserHangDataModel.unscoped().findOne(userHangQuery),
  ]);

  if (!hang) return response.respond(404, 'Hang not found');

  if (!userHangData || userHangData.rsvp !== 'joined') {
    return response.respond(403, 'Has not joined');
  }

  const hangMessagesQuery = {
    where: { hangId, replyToMessageId: null },
    limit: 50,
    order: [ [ 'sentAt', 'DESC' ] ],
  };

  if (upperbound) hangMessagesQuery.where.sentAt = { [Op.lt]: upperbound };

  const scoped = HangMessageModel.scope('withReactions');

  const [
    hangMessages,
  ] = await Promise.all([
    scoped.findAll(hangMessagesQuery),
    userHangData.update({ lastReadAt: new Date() }),
  ]);

  const [
    formatted,
    threads,
  ] = await Promise.all([
    formatMessages(json(hangMessages)),
    getThreads({ user, hangId }),
  ]);

  const resp = {
    hangMessages: formatted,
    threads: threads,
  };

  const value = validate(resp, respSchema);

  return response.respond(200, value);
}));

// DELETE - Delete the specified hang message
router.delete('/', userAuthorize);
router.delete('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({ hangMessageId: idSchema.required() });

  const respSchema = Joi.object({
    id: idSchema.required(),
    dedupingId: Joi.string().uuid().required(),
    hangId: idSchema.required(),
    replyToMessageId: idSchema.allow(null).required(),
  });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangMessageId } = body;

  const message = await HangMessageModel.unscoped().findByPk(hangMessageId);

  if (!message)
    return response.respond(404, 'Message not found');

  if (message.userId !== user.id)
    return response.respond(403, 'Not author');

  if (message.type !== 'TEXT')
    return response.respond(403, 'Cannot delete this message type');

  const userHangQuery = { where: { userId: user.id, hangId: message.hangId } };

  const [
    hang,
    userHangData,
  ] = await Promise.all([
    HangModel.findByPk(message.hangId),
    UserHangDataModel.unscoped().findOne(userHangQuery),
  ]);

  if (!hang)
    return response.respond(404, 'Hang not found');

  const deletedMessageInfo = {
    id: message.id,
    dedupingId: message.dedupingId,
    hangId: message.hangId,
    replyToMessageId: message.replyToMessageId,
  };

  if (message.replyToMessageId) await updateThreads(user, message);

  await Promise.all([
    message.destroy(),
    userHangData.update({ lastReadAt: new Date() }),
  ]);

  if (hang.lastMessageId === hangMessageId) {
    const predecessorQuery = {
      where: {
        hangId: hang.id,
        replyToMessageId: null,
      },
      attributes: [ 'id', 'sentAt' ],
      order: [ [ 'sentAt', 'DESC' ] ],
      limit: 1,
    };

    const pm = await HangMessageModel.findOne(predecessorQuery);
    await hang.update({ lastMessageId: pm.id, lastMessageAt: pm.sentAt });
  }

  const resp = deletedMessageInfo;

  const value = validate(resp, respSchema);

  const data = {
    sender: formatToUserBase(user),
    deletedMessageInfo: value,
  };

  const dataSchema = Joi.object({
    sender: userBaseSchema.required(),
    deletedMessageInfo: respSchema.required(),
  });

  const dataValue = validate(data, dataSchema);

  const alert = {
    sender: formatToUserBase(user),
    type: value.replyToMessageId
      ? 'HANG_MESSAGE_REPLY_DELETE'
      : 'HANG_MESSAGE_DELETE',
    push: null,
    data: dataValue,
  };

  (env === 'local')
    ? await hang.notifyHangUsers(alert)
    : hang.notifyHangUsers(alert);

  return response.respond(200, value);
}));

/* Helpers */

async function sendAlerts({ user, hang, resp }) {
  const { text, embeds, attachments } = resp;

  let notification = '';

  if (text) {
    notification = text;
  }

  else if (attachments && attachments.length === 1) {
    notification = (attachments[0].mediaType === 'image')
      ? 'Sent an image'
      : 'Sent a video';
  }

  else if (attachments && attachments.length > 1) {
    const images = attachments.filter(a => a.mediaType === 'image');
    const videos = attachments.filter(a => a.mediaType === 'video');

    if (images.length === attachments.length)
      notification = `Sent ${images.length} images`;

    else if (videos.length === attachments.length)
      notification = `Sent ${videos.length} videos`;

    else
      notification = `Sent ${attachments.length} attachments`;
  }

  else if (embeds && embeds.length) {
    notification = (embeds.length > 1)
      ? `Sent ${embeds.length} links: ${embeds[0].title}`
      : `Sent a link: ${embeds[0].title}`;
  }

  const data = {
    sender: formatToUserBase(user),
    hangMessage: resp,
  };

  const dataSchema = Joi.object({
    sender: userBaseSchema.required(),
    hangMessage: hangMessageSchema.required(),
  });

  const value = validate(data, dataSchema);

  const push = {
    title: `${user.firstName} to ${hang.title}`,
    message: notification,
  };

  const alert = {
    sender: formatToUserBase(user),
    type: 'HANG_MESSAGE_CREATE',
    push,
    data: value,
  };

  (env === 'local')
    ? await hang.notifyHangUsers(alert)
    : hang.notifyHangUsers(alert);
}

async function sendReplyAlerts({ user, hang, rootMessage, author, resp }) {
  const { text, embeds, attachments } = resp;

  let notification = '';

  if (text) {
    notification = text;
  }

  else if (attachments && attachments.length === 1) {
    notification = (attachments[0].mediaType === 'image')
      ? 'Replied with an image'
      : 'Replied with a video';
  }

  else if (attachments && attachments.length > 1) {
    const images = attachments.filter(a => a.mediaType === 'image');
    const videos = attachments.filter(a => a.mediaType === 'video');

    if (images.length === attachments.length)
      notification = `Replied with ${images.length} images`;

    else if (videos.length === attachments.length)
      notification = `Replied with ${videos.length} videos`;

    else
      notification = `Replied with ${attachments.length} attachments`;
  }

  else if (embeds && embeds.length) {
    notification = (embeds.length > 1)
      ? `Replied with ${embeds.length} links`
      : `Replied with a link: ${embeds[0].title}`;
  }

  const repliesQuery = {
    where: {
      userId: { [Op.notIn]: [ rootMessage.userId , user.id ] },
      replyToMessageId: rootMessage.id,
    },
  };

  const othersReplies = await HangMessageModel.unscoped().findAll(repliesQuery);
  const otherReplierUserIds = othersReplies.map(reply => reply.userId);
  const userIdsInThread = otherReplierUserIds.concat(rootMessage.userId);
  if (rootMessage.userId !== user.id) userIdsInThread.concat(user.id);

  const data = {
    sender: formatToUserBase(user),
    hangMessage: resp,
    rootMessageUserId: rootMessage.userId,
    userIdsInThread,
  };

  const dataSchema = Joi.object({
    sender: userBaseSchema.required(),
    hangMessage: hangReplyMessageSchema.required(),
    rootMessageUserId: idSchema.required(),
    userIdsInThread: Joi.array().items(idSchema).required(),
  });

  const value = validate(data, dataSchema);
  
  const alertMqtt = {
    sender: formatToUserBase(user),
    type: 'HANG_MESSAGE_REPLY',
    push: null,
    data: value,
  };

  const promises = [ hang.notifyHangUsers(alertMqtt) ];

  const rootQuery = { where: { userId: rootMessage.userId, hangId: hang.id } };
  const rootUserHangData = await UserHangDataModel.findOne(rootQuery);

  if (user.id !== rootMessage.userId && !rootUserHangData.isMuted) {
    const pushRootAuthor = {
      type: 'HANG_MESSAGE_REPLY',
      push: {
        title: `${user.firstName} replied to your message`,
        subtitle: rootMessage.text || undefined,
        message: notification,
      },
      noMqtt: true,
      recipientId: author.id,
      data: value,
    };

    promises.push(sendAlert(pushRootAuthor));
  }

  if (othersReplies) {
    const repliersQuery = {
      where: { id: { [Op.in]: otherReplierUserIds } },
      include: [
        {
          model: UserHangDataModel,
          as: 'userHangsData',
          where : { hangId: hang.id },
        },
      ],
    };

    const repliers = await UserModel.findAll(repliersQuery);

    repliers.forEach(replier => {
      if (!replier.userHangsData.isMuted) {
        const pushReplier = {
          type: 'HANG_MESSAGE_REPLY',
          push: {
            title: `${user.firstName} replied to a thread`,
            subtitle: rootMessage.text || undefined,
            message: notification,
          },
          noMqtt: true,
          recipientId: replier.id,
          data: value,
        };

        promises.push(sendAlert(pushReplier));
      }
    });

    (env === 'local')? await Promise.all(promises) : Promise.all(promises);
  }
}

module.exports = router;
