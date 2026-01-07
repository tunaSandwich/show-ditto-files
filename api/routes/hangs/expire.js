const userAuthorize = rootRequire('/middlewares/users/authorize');
const HangModel = rootRequire('/models/Hang');
const Joi = require('joi');

const { asyncHandler } = rootRequire('/libs/helpers');
const { idSchema } = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// PATCH - Expire a hang the current user has authored
router.patch('/', userAuthorize);
router.patch('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({ hangId: idSchema.required() });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const hang = await HangModel.findOne({ where: { id: body.hangId }});
  if (!hang) return response.respond(404, 'Hang not found');
  if (hang.authorId !== user.id) return response.respond(403, 'Not author');

  await hang.update({ expiresAt: new Date() });

  return response.respond(204);
}));

module.exports = router;
