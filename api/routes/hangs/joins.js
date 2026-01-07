const FriendModel = rootRequire('/models/Friend');
const HangMessageModel = rootRequire('/models/HangMessage');
const HangModel = rootRequire('/models/Hang');
const ReactionModel = rootRequire('/models/Reaction');
const ThoughtModel = rootRequire('/models/Thought');
const ThoughtHitModel = rootRequire('/models/ThoughtHit');
const UserHangDataModel = rootRequire('/models/UserHangData');
const UserModel = rootRequire('/models/User');

const userAuthorize = rootRequire('/middlewares/users/authorize');
const analytics = rootRequire('/setup/analytics');

const Joi = require('joi');

const { postFirstHangJoinToSlack } = rootRequire('/libs/slackHelpers');
const { teamDittoUserId } = rootRequire('/config/app');
const { sendAlert } = rootRequire('/libs/alerts');
const { Op } = Sequelize;

const {
  createJoinedMessage,
  formatToUserBase,
  getHangBasics,
  asyncHandler,
  formatHang,
  getBlock,
  getAge,
} = rootRequire('/libs/helpers');

const {
  hangMessageSchema,
  userBaseSchema,
  hangSchema,
  idSchema,
} = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// POST - Join the specified hang
router.post('/', userAuthorize);
router.post('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangId: Joi.number().integer().min(1),
    shareCode: Joi.string().min(9).max(18),
    inviteCode: Joi.string().min(9).max(18).optional(),
  }); //.with('shareCode', 'inviteCode').or('hangId', 'shareCode');
  // TODO: PUT IT BACK

  const respSchema = hangSchema;

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId, shareCode, inviteCode } = request.body;

  const scoped = HangModel.scope({ method: [ 'preview', [ 'joined' ] ]});
  const hangQuery = { where: hangId ? { id: hangId } : { shareCode } };
  const userHangQuery = { where: { userId: user.id, hangId: hangId } };

  const [
    hang,
    userHangData,
  ] = await Promise.all([
    scoped.findOne(hangQuery),
    UserHangDataModel.unscoped().findOne(userHangQuery),
  ]);

  if (!hang) return response.respond(404, 'Hang not found');

  if (hangId && shareCode) {
    if ((hangId !== hang.id) || (shareCode !== hang.shareCode)) {
      return response.respond(409, 'Hang id and code do not match');
    }
  }

  const isBlocked = await getBlock(user.id, hang.author.id);
  if (isBlocked) return response.respond(403, 'Blocked');

  const inviter = inviteCode
    ? await UserModel.findOne({ where: { inviteCode } })
    : null;

  if (inviteCode && !inviter) {
    return response.respond(404, 'Invalid invite code');
  }

  const isOnList = userHangData;
  const isInvitedByAuthor = inviter && inviter.id === hang.author.id;

  const isValidShareCode = (hang.isShareable && shareCode === hang.shareCode)
    || (!hang.isShareable && shareCode === hang.shareCode && isInvitedByAuthor)
    || (user.id === hang.author.id);

  if (shareCode && !isValidShareCode && !isOnList) {
    return response.respond(403, 'Invalid share code');
  }

  const age = user.birthdate ? getAge(user.birthdate) : null;

  if (hang.minAge && (age < hang.minAge || !age)) {
    if (!isOnList && !isInvitedByAuthor) {
      return response.respond(403, 'Too young for this hang');
    }
  }

  if (hang.maxAge && (age > hang.maxAge || !age)) {
    if (!isOnList && !isInvitedByAuthor) {
      return response.respond(403, 'Too old for this hang');
    }
  }

  if (hang.collegeDomain) {
    if (!isOnList && !isInvitedByAuthor) {
      if (user.collegeDomain !== hang.collegeDomain || !user.collegeDomain) {
        return response.respond(403, 'College only hang');
      }

      if (age < 18 || !age) {
        return response.respond(403, 'Too young for college hang');
      }

      if (age > 24 || !age) {
        return response.respond(403, 'Too old for college hang');
      }
    }
  }

  // TODO: PUT IT BACK
  // if (hang.visibility === 'private') {
  //   if (!isOnList && !isInvitedByAuthor && !isValidShareCode) {
  //     return response.respond(403, 'Not invited to private hang');
  //   }
  // }

  if (hang.visibility === 'friends') {
    const query = {
      where: {
        status: 'active',
        [Op.or]: [
          { initiatingUserId: hang.author.id, targetUserId: user.id },
          { initiatingUserId: user.id, targetUserId: hang.author.id },
        ],
      },
    };

    const friendship = await FriendModel.findOne(query);

    if (!friendship && !isOnList && !isInvitedByAuthor && !isValidShareCode) {
      return response.respond(403, 'Not friends with author');
    }
  }

  if (userHangData && userHangData.rsvp === 'joined') {
    return response.respond(409, 'Already joined hang');
  }

  await joinHang(user, hang, userHangData, inviter);
  const resp = await getResponseHang(user, hang);

  const value = validate(resp, respSchema);

  const targetIds = value.joined.map(j => j.id);

  await Promise.all([
    alertUsers(user, value, targetIds, 'HANG_JOIN'),
    postToSlackIfFirstJoin(user, value),
  ]);

  await analytics.track({
    userId: user.id,
    event: 'Hang Joined',
    properties: { hang: getHangBasics(value) },
  });

  return response.respond(201, value);
}));

// GET - Retrieve the specified hang
router.get('/', userAuthorize);
router.get('/', asyncHandler(async (request, response) => {
  const { user } = request;

  const reqSchema = Joi.object({
    hangId: Joi.number().integer().min(1).required(),
  });

  const respSchema = hangSchema;

  const reqError = reqSchema.validate(request.query).error;
  if (reqError) { return response.respond(400, reqError.message); }
  const hangId = parseInt(request.query.hangId);

  const userHangQuery = { where: { userId: user.id, hangId: hangId } };

  const [
    hang,
    userHangData,
  ] = await Promise.all([
    HangModel.findByPk(hangId),
    UserHangDataModel.unscoped().findOne(userHangQuery),
  ]);

  if (!hang) return response.respond(404, 'Hang not found');

  const isBlocked = await getBlock(user.id, hang.authorId);
  if (isBlocked) return response.respond(403, 'Blocked');

  if (!userHangData || userHangData.rsvp !== 'joined') {
    return response.respond(403, 'Has not joined');
  }

  await userHangData.update({ lastReadAt: new Date() });

  const thoughtHitQuery = {
    where: {
      thoughtId: hang.createdFromThoughtId,
      userId: user.id,
    },
    include: [
      {
        model: ThoughtModel.scope('inMessage'),
        as: 'thought',
        attributes: {
          exclude: [ 'lastOpenedAt', 'webUserRegistrationsRemaining' ],
        },
      },
      {
        model: UserModel.scope('base'),
        as: 'user',
      },
    ],
  };

  const thoughtHit = await ThoughtHitModel.findOne(thoughtHitQuery);

  const resp = await getResponseHang(user, hang, thoughtHit);

  const value = validate(resp, respSchema);

  return response.respond(200, value);
}));

// DELETE - Leave the specified hang
router.delete('/', userAuthorize);
router.delete('/', asyncHandler(async (request, response) => {
  const { user } = request;

  const reqSchema = Joi.object({ hangId: idSchema.required() });

  const reqError = reqSchema.validate(request.body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId } = request.body;

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

  if (user.id === hang.authorId) {
    return response.respond(409, 'Author cannot leave hang');
  }

  await removeUserFromHang(user, userHangData, hang);

  return response.respond(204);
}));

async function joinHang(user, hang, userHangData, inviter) {
  const hangMsg = await createJoinedMessage(user, hang);

  if (userHangData) {
    await userHangData.update({
      rsvp: 'joined',
      lastReadAt: hangMsg.sentAt,
      usedInviteFromUserId: inviter ? inviter.id: null,
    });
  }

  else {
    await hang.addParticipant(user, { as: 'user', through: {
      rsvp: 'joined',
      lastReadAt: hangMsg.sentAt,
      usedInviteFromUserId: inviter ? inviter.id: null,
    } });
  }

  await hang.update({ usersCount: hang.usersCount + 1 });
}

// This function is duplicated in /routes/hangs/joins/add.js
async function getResponseHang(user, hang, thoughtHit) {
  const rsvpStatuses = (user.id === hang.authorId)
    ? [ 'joined', 'pending', 'left' ]
    : [ 'joined', 'left' ];

  const scoped = HangModel.scope({
    method: [ 'complete', user.id, rsvpStatuses ],
  });

  const completeHang = await scoped.findByPk(hang.id);
  const completeHangJSON = completeHang.toJSON();
  completeHangJSON.thoughtHit = thoughtHit ? thoughtHit.toJSON() : null;

  return await formatHang({ hang: completeHangJSON, user });
}

async function postToSlackIfFirstJoin(user, hang) {
  const query = {
    where: {
      userId: user.id,
      rsvp: 'joined',
    },
    include: [
      {
        model: HangModel,
        as: 'hang',
        where: {
          authorId: { [Op.not]: teamDittoUserId },
          id: { [Op.not]: hang.id },
        },
      },
    ],
  };

  const joins = await UserHangDataModel.findAll(query);

  if ((!joins || !joins.length) && hang.visibility !== 'private') {
    await postFirstHangJoinToSlack(user, hang);
  }
}

// This function is duplicated in /routes/hangs/joins/add.js
async function alertUsers(user, hang, targetIds, type) {
  const targetQuery = { where: { id: { [Op.in]: targetIds } } };
  const targets = await UserModel.findAll(targetQuery);

  const authorQuery = { where: { userId: hang.author.id, hangId: hang.id } };
  const authorUserHangData = await UserHangDataModel.findOne(authorQuery);

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

    if (type === 'HANG_JOIN') {
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

    const shouldSendPush = type === 'HANG_JOIN'
      && !authorUserHangData.isMuted
      && target.id === hang.author.id;

    if (shouldSendPush) {
      alert.push = {
        title: `${user.firstName} joined the hang!`,
        message: hang.title,
      };
    }

    promises.push(sendAlert(alert));
  });

  (env === 'local') ? await Promise.all(promises) : Promise.all(promises);
}

// This function is duplicated in /routes/hangs/joins/add.js
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
