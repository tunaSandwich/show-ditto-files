const HangModel = rootRequire('/models/Hang');
const UserHangDataModel = rootRequire('/models/UserHangData');

const userAuthorize = rootRequire('/middlewares/users/authorize');
const analytics = rootRequire('/setup/analytics');
const Joi = require('joi');

const { asyncHandler } = rootRequire('/libs/helpers');
const { idSchema } = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// POST - Mute notifications for the specified hang
router.post('/', userAuthorize);
router.post('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangId: idSchema.required(),
  });

  const respSchema = Joi.object({});

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId } = request.body;

  const hang = await HangModel.findByPk(hangId);
  if (!hang) return response.respond(404, 'Hang not found');

  const userHangDataQuery = { where: { userId: user.id, hangId }};
  const userHangData = await UserHangDataModel.findOne(userHangDataQuery);

  if (!userHangData || userHangData.rsvp === 'pending') {
    return response.respond(403, 'Has not joined hang');
  }

  if (userHangData.isMuted) {
    return response.respond(409, 'Hang was already muted');
  }

  await userHangData.update({ isMuted: true });

  const resp = {};

  const value = validate(resp, respSchema);

  await analytics.track({
    userId: user.id,
    event: 'Hang Chat Muted',
    properties: { hang: hang.toJSON() },
  });

  return response.respond(200, value);
}));

// DELETE - Unmute notifications for specified hang
router.delete('/', userAuthorize);
router.delete('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangId: idSchema.required(),
  });

  const respSchema = Joi.object({});

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId } = request.body;

  const hang = await HangModel.findByPk(hangId);
  if (!hang) return response.respond(404, 'Hang not found');

  const userHangDataQuery = { where: { userId: user.id, hangId }};
  const userHangData = await UserHangDataModel.findOne(userHangDataQuery);

  if (!userHangData || userHangData.rsvp === 'pending') {
    return response.respond(403, 'Has not joined hang');
  }

  if (!userHangData.isMuted) {
    return response.respond(409, 'Hang was not muted');
  }

  await userHangData.update({ isMuted: false });

  const resp = {};

  const value = validate(resp, respSchema);

  await analytics.track({
    userId: user.id,
    event: 'Hang Chat Unmuted',
    properties: { hang: hang.toJSON() },
  });

  return response.respond(200, value);
}));

module.exports = router;
