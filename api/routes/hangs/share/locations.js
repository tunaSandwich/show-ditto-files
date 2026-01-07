const HangModel = rootRequire('/models/Hang');

const userAuthorize = rootRequire('/middlewares/users/authorize');
const Joi = require('joi');

const {
  getSortedFriends,
  asyncHandler,
} = rootRequire('/libs/helpers');

const {
  sortedFriendPreview,
  safeLocationSchema,
  idSchema,
} = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// PUT - Retrieve a list of suggested friends to share a hang with
router.put('/', userAuthorize);
router.put('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    location: safeLocationSchema.allow(null).required(),
    hangId: idSchema.required(),
  });

  const respSchema = Joi.object({
    friends: Joi.array().items(sortedFriendPreview).required(),
  });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { location, hangId } = request.body;

  await user.updateLocation({ location });

  const hang = await HangModel.scope('withCategories').findByPk(hangId);

  if (!hang) return response.respond(404, 'Hang not found');

  const categoryIds = hang.categories && hang.categories.map(c => c.id);

  const friends = (user.id === hang.authorId)
    ? await getSortedFriends({ user, categoryIds, hang })
    : await getSortedFriends({ user, categoryIds });


  const resp = { friends };

  const value = validate(resp, respSchema);

  return response.respond(200, value);
}));

module.exports = router;
