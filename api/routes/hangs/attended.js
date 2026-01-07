const userAuthorize = rootRequire('/middlewares/users/authorize');
const HangModel = rootRequire('/models/Hang');
const UserHangDataModel = rootRequire('/models/UserHangData');
const analytics = rootRequire('/setup/analytics');
const Joi = require('joi');

const {
  getHangBasics,
  asyncHandler,
} = rootRequire('/libs/helpers');

const {
  idSchema,
} = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// PATCH - Indicate whether a user actually attended a hang.
router.patch('/', userAuthorize);
router.patch('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangId: idSchema.required(),
    didAttend: Joi.boolean().required(),
  });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId, didAttend } = body;

  const uhdQuery = {
    where: {
      userId: user.id,
      hangId: hangId,
    },
  };

  const [
    hang,
    userHangData,
  ] = await Promise.all([
    HangModel.unscoped().findByPk(hangId),
    UserHangDataModel.unscoped().findOne(uhdQuery),
  ]);

  if (!hang) return response.respond(404, 'Hang not found');
  if (!userHangData) return response.respond(404, 'Not a hang participant');

  if (userHangData.rsvp !== 'joined')
    return response.respond(403, 'User did not join hang');

  if (userHangData.didAttend === true && didAttend)
    return response.respond(409, 'Already marked attended');

  if (userHangData.didAttend === false && !didAttend)
    return response.respond(409, 'Already marked not attended');

  const promises = [];
  promises.push(userHangData.update({ didAttend }));
  const hangBasics = getHangBasics(hang.toJSON());

  promises.push(analytics.track({
    userId: user.id,
    event: 'Changed Hang Attendance',
    properties: {
      hangId: hang.id,
      hang: hangBasics,
      didAttend,
    },
  }));

  if (!hang.didHappen) {
    promises.push(hang.update({ didHappen: true }));
    hangBasics.didHappen = true;

    promises.push(analytics.track({
      userId: hang.authorId,
      event: 'Hang Happened',
      properties: {
        hangId: hang.id,
        hang: hangBasics,
      },
    }));
  }

  (env === 'local') ? await Promise.all(promises) : Promise.all(promises);

  return response.respond(204);
}));

module.exports = router;
