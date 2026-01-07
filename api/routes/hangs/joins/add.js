const HangMessageModel = rootRequire('/models/HangMessage');
const HangModel = rootRequire('/models/Hang');
const ReactionModel = rootRequire('/models/Reaction');
const UserHangDataModel = rootRequire('/models/UserHangData');
const UserModel = rootRequire('/models/User');
const UserFriendDataModel = rootRequire('/models/UserFriendData');
const ThoughtModel = rootRequire('/models/Thought');

const userAuthorize = rootRequire('/middlewares/users/authorize');
const analytics = rootRequire('/setup/analytics');
const Joi = require('joi');

const { sendAlert } = rootRequire('/libs/alerts');
const { Op } = Sequelize;

const {
  formatToUserBase,
  getHangBasics,
  asyncHandler,
  formatHang,
  getBlock,
} = rootRequire('/libs/helpers');

const {
  hangMessageSchema,
  userBaseSchema,
  hangSchema,
  idSchema,
} = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// POST - Add a user to the specified hang (hang author only)
router.post('/', userAuthorize);
router.post('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangId: idSchema.required(),
    targetUserId: idSchema.required(),
  });

  const respSchema = hangSchema;

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId, targetUserId } = body;

  const scoped = HangModel.scope({ method: [ 'preview', [ 'joined' ] ]});
  const userHangQuery = { where: { userId: targetUserId, hangId: hangId } };

  const [
    hang,
    targetUser,
    targetUserHangData,
    ufd,
  ] = await Promise.all([
    scoped.findByPk(hangId),
    UserModel.unscoped().findByPk(targetUserId),
    UserHangDataModel.unscoped().findOne(userHangQuery),
    UserFriendDataModel.unscoped().findOne({
      where: { userId: user.id, friendUserId: targetUserId },
    }),
  ]);

  if (!targetUser) return response.respond(404, 'User not found');
  if (!hang) return response.respond(404, 'Hang not found');
  if (hang.author.id !== user.id) return response.respond(403, 'Not author');
  if (targetUserHangData && targetUserHangData.rsvp === 'joined')
    return response.respond(409, 'Already joined');

  const isBlocked = await getBlock(user.id, targetUserId);
  if (isBlocked) return response.respond(403, 'Blocked');

  await addUserToHang(targetUser, hang, targetUserHangData);
  const resp = await getResponseHang(targetUser, hang);

  const value = validate(resp, respSchema);

  const targetIds = value.joined.map(j => j.id);

  const data = {
    sender: formatToUserBase(user),
    recipientId: targetUser.id,
    hang: getHangBasics(value),
  };

  const dataSchemaAdd = Joi.object({
    sender: userBaseSchema.required(),
    recipientId: idSchema.required(),
    hang: hangSchema.required(),
  });

  const dataValue = validate(data, dataSchemaAdd);

  const targetAlert = {
    type: 'HANG_ADD',
    push: {
      title: `${user.firstName} invited you to a hang!`,
      subtitle: hang.title,
      message: 'Are you in? ✅👀',
    },
    recipientId: targetUser.id,
    data: dataValue,
  };

  const thought = hang.createdFromThoughtId
    ? await ThoughtModel.unscoped().findByPk(hang.createdFromThoughtId)
    : null;

  await Promise.all([
    sendAlert(targetAlert),
    alertUsers(targetUser, value, targetIds, 'HANG_ADD'),
    analytics.track({
      userId: user.id,
      event: 'Hang Add Sent',
      properties: {
        hangId: hang.id,
        friendshipId: ufd ? ufd.friendshipId : null,
        thoughtId: thought ? thought.id : null,
        thought: thought ? thought : null,
      },
    }),
    analytics.track({
      userId: targetUserId,
      event: 'Hang Add Received',
      properties: {
        hangId: hang.id,
        friendshipId: ufd ? ufd.friendshipId : null,
        thoughtId: thought ? thought.id : null,
        thought: thought ? thought : null,
      },
    }),
  ]);

  return response.respond(201, value);
}));

// DELETE - Remove a user from the specified hang (hang author only)
router.delete('/', userAuthorize);
router.delete('/', asyncHandler(async (request, response) => {
  const { user } = request;

  const reqSchema = Joi.object({
    hangId: idSchema.required(),
    targetUserId: idSchema.required(),
  });

  const reqError = reqSchema.validate(request.body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId, targetUserId } = request.body;

  const userHangQuery = { where: { userId: targetUserId, hangId: hangId } };

  const [
    hang,
    targetUser,
    targetUserHangData,
  ] = await Promise.all([
    HangModel.findByPk(hangId),
    UserModel.findByPk(targetUserId),
    UserHangDataModel.unscoped().findOne(userHangQuery),
  ]);

  if (!hang) return response.respond(404, 'Hang not found');
  if (!targetUser) return response.respond(404, 'User not found');
  if (user.id !== hang.authorId) return response.respond(403, 'Not author');

  if (!targetUserHangData || targetUserHangData.rsvp !== 'joined') {
    return response.respond(409, 'Has not joined');
  }

  if (targetUserId === hang.authorId) {
    return response.respond(409, 'Author cannot leave hang');
  }

  await removeUserFromHang(targetUser, targetUserHangData, hang);

  return response.respond(204);
}));

// This function is duplicated in /routes/hangs/joins.js
async function addUserToHang(user, hang, userHangData) {
  const hangMsg = await createAddedMessage(user, hang);

  if (userHangData) {
    await userHangData.update({ rsvp: 'joined', lastReadAt: hangMsg.sentAt });
  }

  else {
    await hang.addParticipant(user, { as: 'user', through: {
      rsvp: 'joined',
      wasAddedByAuthor: true,
      didSeeAddByAuthor: false,
    } });
  }

  await hang.update({ usersCount: hang.usersCount + 1 });
}

async function createAddedMessage(user, hang) {
  const fields = {
    sentAt: new Date(),
    hangId: hang.id,
    userId: user.id,
    type: 'JOIN',
    addedByUserId: hang.author.id,
  };

  const hangMessage = await HangMessageModel.create(fields);
  return hangMessage;
}

// This function is duplicated in /routes/hangs/joins.js
async function getResponseHang(user, hang) {
  const rsvpStatuses = (user.id === hang.authorId)
    ? [ 'joined', 'pending', 'left' ]
    : [ 'joined', 'left' ];

  const scoped = HangModel.scope({
    method: [ 'complete', user.id, rsvpStatuses ],
  });

  const completeHang = await scoped.findByPk(hang.id);
  return await formatHang({ hang: completeHang.toJSON(), user });
}

// This function is almost duplicated in /routes/hangs/joins.js
async function alertUsers(user, hang, targetIds, type) {
  const targetQuery = { where: { id: { [Op.in]: targetIds } } };
  const targets = await UserModel.findAll(targetQuery);

  const dataSchemaJoin = Joi.object({
    sender: userBaseSchema.required(),
    target: Joi.object({ id: idSchema.required() }).required(),
    hangMessage: hangMessageSchema.required(),
    hang: Joi.object({
      id: idSchema.required(),
      title: Joi.string().allow('').max(250).required(),
    }).required(),
  });

  const dataSchemaLeave = Joi.object({
    sender: userBaseSchema.required(),
    target: Joi.object({ id: idSchema.required() }).required(),
    hang: Joi.object({ id: idSchema.required() }).required(),
  });

  const promises = [];

  targets.forEach(target => {
    let data, dataSchema;

    if (type === 'HANG_ADD') {
      data = {
        sender: formatToUserBase(user),
        target : { id: target.id },
        hangMessage: hang.hangMessages[0],
        hang: { id: hang.id, title: hang.title },
      };

      dataSchema = dataSchemaJoin;
    }

    if (type === 'HANG_LEAVE' || type === 'HANG_LEAVE_NO_TRACE') {
      data = {
        sender: formatToUserBase(user),
        target : { id: target.id },
        hang: { id: hang.id },
      };

      dataSchema = dataSchemaLeave;
    }

    const value = validate(data, dataSchema);

    const alert = {
      type,
      push: null,
      recipientId: target.id,
      data: value,
    };

    promises.push(sendAlert(alert));
  });

  (env === 'local') ? await Promise.all(promises) : Promise.all(promises);
}

// This function is duplicated in /routes/hangs/joins.js
async function removeUserFromHang(user, userHangData, hang) {
  await userHangData.destroy();

  const messagesQuery = {
    where: { userId: user.id, hangId: hang.id, type: { [Op.not]: 'JOIN' } },
  };

  const reactionsQuery = { where: { userId: user.id, hangId: hang.id } };

  const [
    messages,
    reactions,
    lastMessage,
  ] = await Promise.all([
    HangMessageModel.findAll(messagesQuery),
    ReactionModel.findAll(reactionsQuery),
    HangMessageModel.findByPk(hang.lastMessageId),
    hang.removeParticipant(user),
    hang.update({ usersCount: hang.usersCount - 1 }),
  ]);

  let eventName = 'HANG_LEAVE_NO_TRACE';

  if ((messages && messages.length) || (reactions && reactions.length)) {
    eventName = 'HANG_LEAVE';
    await hang.addParticipant(user, { as: 'user', through: { rsvp: 'left' } });
  }

  else {
    await HangMessageModel.destroy({
      where: { userId: user.id, hangId: hang.id, type: 'JOIN' },
    });
  }

  if (lastMessage.userId === user.id) {
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

  const fullHang = await getResponseHang(user, hang);
  const targetIds = fullHang.joined.map(j => j.id);
  await alertUsers(user, fullHang, targetIds, eventName);
}

module.exports = router;
