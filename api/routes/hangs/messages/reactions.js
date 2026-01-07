const HangModel = rootRequire('/models/Hang');
const HangMessageModel = rootRequire('/models/HangMessage');
const ReactionModel = rootRequire('/models/Reaction');
const UserHangDataModel = rootRequire('/models/UserHangData');
const UserModel = rootRequire('/models/User');

const userAuthorize = rootRequire('/middlewares/users/authorize');
const emojilib = require('emojilib');
const Joi = require('joi');

const { sendAlert } = rootRequire('/libs/alerts');

const {
  reactionHangMessageSchema,
  userBaseSchema,
  idSchema,
} = rootRequire('/libs/schemas');

const {
  formatToUserBase,
  asyncHandler,
} = rootRequire('/libs/helpers');

const router = express.Router({ mergeParams: true });

// POST - React to a hang message with an emoji
router.post('/', userAuthorize);
router.post('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangMessageId: idSchema.required(),
    emoji: Joi.string().required(),
  });

  const respSchema = reactionHangMessageSchema;

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangMessageId, emoji } = body;

  if (!emojilib[emoji]) {
    return response.respond(400, `Invalid emoji ${emoji}`);
  }

  const hangMessage = await HangMessageModel.unscoped().findByPk(hangMessageId);

  if (!hangMessage) {
    return response.respond(404, 'Hang message not found');
  }

  const [
    hang,
    messageAuthor,
  ] = await Promise.all([
    HangModel.findByPk(hangMessage.hangId),
    UserModel.findByPk(hangMessage.userId),
  ]);

  if (!hang) {
    return response.respond(500, `No hang for message ${hangMessage.id}`);
  }

  if (!messageAuthor) {
    return response.respond(500, `No author for message ${hangMessage.id}`);
  }

  const fields = {
    emoji,
    hangMessageId,
    userId: user.id,
    hangId: hang.id,
  };

  const hangUsersQuery = { where: { hangId: hang.id, userId: user.id }};

  const [
    dupe,
    invitee,
  ] = await Promise.all([
    ReactionModel.findOne({ where: fields }),
    UserHangDataModel.findOne(hangUsersQuery),
  ]);

  if (!invitee || invitee.rsvp !== 'joined') {
    return response.respond(403, 'Has not joined hang');
  }

  if (dupe) {
    const dupeResp = dupe.toJSON();
    delete dupeResp.user.location;

    const value = validate(dupeResp, respSchema);

    return response.respond(409, value);
  }

  const { id } = await ReactionModel.create(fields);
  const reaction = await ReactionModel.scope('defaultScope').findByPk(id);

  const resp = reaction.toJSON();
  delete resp.user.location;

  const value = validate(resp, respSchema);

  const dataSchema = Joi.object({
    sender: userBaseSchema.required(),
    reaction: reactionHangMessageSchema.required(),
    replyToMessageId: idSchema.allow(null).required(),
  });

  const data = {
    sender: formatToUserBase(user),
    reaction: value,
    replyToMessageId: hangMessage.replyToMessageId,
  };

  const valueData = validate(data, dataSchema);

  const alertMqtt = {
    sender: user,
    type: 'HANG_MESSAGE_REACTION',
    push: null,
    data: valueData,
  };

  const promises = [ hang.notifyHangUsers(alertMqtt) ];

  if (user.id !== messageAuthor.id && hangMessage.type === 'TEXT') {
    const pushAuthor = {
      type: 'HANG_MESSAGE_REACTION',
      push: {
        title: `${user.firstName} reacted to your message`,
        subtitle: hangMessage.text || undefined,
        message: valueData.reaction.emoji,
      },
      noMqtt: true,
      avoidIncrementingBadgeCount: true,
      recipientId: messageAuthor.id,
      data: valueData,
    };

    promises.push(sendAlert(pushAuthor));
  }

  (env === 'local')? await Promise.all(promises) : Promise.all(promises);

  return response.respond(201, value);
}));

// DELETE - Delete an emoji reaction to a hang message
router.delete('/', userAuthorize);
router.delete('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({ reactionId: idSchema.required() });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { reactionId } = body;

  const reaction = await ReactionModel.findByPk(reactionId);

  if (!reaction) return response.respond(404, 'Reaction not found');
  if (user.id !== reaction.userId) return response.respond(403, 'Not author');

  const [
    hangMessage,
    hang,
  ] = await Promise.all([
    HangMessageModel.unscoped().findByPk(reaction.hangMessageId),
    HangModel.unscoped().findByPk(reaction.hangId),
  ]);

  if (!hang) {
    return response.respond(500, `No hang for reaction ${reactionId}`);
  }

  if (!hangMessage) {
    throw response.respond(500, `No hang message for reaction ${reactionId}`);
  }

  await reaction.destroy();

  const dataSchema = Joi.object({
    sender: userBaseSchema.required(),
    deletedReaction: reactionHangMessageSchema.required(),
    replyToMessageId: idSchema.allow(null).required(),
  });

  const data = {
    sender: formatToUserBase(user),
    deletedReaction: reaction.toJSON(),
    replyToMessageId: hangMessage.replyToMessageId,
  };

  const valueData = validate(data, dataSchema);

  const alert = {
    sender: user,
    type: 'HANG_MESSAGE_REACTION_DELETE',
    push: null,
    data: valueData,
  };

  (env === 'local')
    ? await hang.notifyHangUsers(alert)
    : hang.notifyHangUsers(alert);

  return response.respond(204);
}));

module.exports = router;
