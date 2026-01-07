const userAuthorize = rootRequire('/middlewares/users/authorize');
const HangModel = rootRequire('/models/Hang');
const ThoughtModel = rootRequire('/models/Thought');
const ThoughtHitModel = rootRequire('/models/ThoughtHit');
const UserModel = rootRequire('/models/User');
const UserHangDataModel = rootRequire('/models/UserHangData');
const analytics = rootRequire('/setup/analytics');
const Joi = require('joi');

const { sendAlert } = rootRequire('/libs/alerts');

const {
  formatToUserBase,
  getThoughtBasics,
  getHangBasics,
  asyncHandler,
  formatHang,
} = rootRequire('/libs/helpers');

const {
  userBaseSchema,
  hangSchema,
  idSchema,
} = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// PATCH - Change a user's attendance status for a hang
router.patch('/', userAuthorize);
router.patch('/', asyncHandler(async (request, response) => {
  const { user, body } = request;

  const reqSchema = Joi.object({
    hangId: idSchema.required(),
    isConfirmed: Joi.boolean().required(),
  });

  const reqError = reqSchema.validate(body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { hangId, isConfirmed } = body;

  const scoped = HangModel
    .scope({ method: [ 'complete', user.id, [ 'joined' ] ] });

  const hang = await scoped.findByPk(hangId);
  if (!hang) return response.respond(404, 'Hang not found');

  const userHangDataQuery = { where: { userId: user.id, hangId } };

  const [
    userHangData,
    author,
  ] = await Promise.all([
    UserHangDataModel.unscoped().findOne(userHangDataQuery),
    UserModel.scope('alert').findByPk(hang.author.id),
  ]);

  if (!userHangData) return response.respond(403, 'Not a hang participant');

  if (userHangData.rsvp !== 'joined')
    return response.respond(403, 'Must be joined to attend');

  if (isConfirmed && userHangData.isConfirmed)
    return response.respond(409, 'Already confirmed');

  if (!isConfirmed && !userHangData.isConfirmed)
    return response.respond(409, 'Already not confirmed');

  await userHangData.update({
    isConfirmed,
    confirmedAt: isConfirmed ? new Date() : null,
  });

  const formattedHang = await formatHang({ hang: hang.toJSON(), user });
  const hangBasics = getHangBasics(formattedHang);

  const data = {
    sender: formatToUserBase(user),
    isConfirmed,
    confirmedAt: userHangData.confirmedAt,
    hang: hangBasics,
  };

  const dataSchema = Joi.object({
    sender: userBaseSchema.required(),
    isConfirmed: Joi.boolean().required(),
    confirmedAt: Joi.date().timestamp().iso().allow(null).required(),
    hang: hangSchema.required(),
  });

  const value = validate(data, dataSchema);
  
  let subtitle;
  let confirmedCount =
    formattedHang.joined.filter(u => u.userHangData.isConfirmed).length;

  if (user.id !== hang.author.id) {
    if (isConfirmed) {
      subtitle = `${user.fullName} is in! ✅`;
      confirmedCount += 1;
    }

    else {
      subtitle = `${user.fullName} is out.`;
      confirmedCount -= 1;
    }

    const push = {
      title: hang.title,
      subtitle,
      message: (confirmedCount === 1)
        ? `${confirmedCount} person has confirmed`
        : `${confirmedCount} people have confirmed`,
    };

    const pushAuthor = {
      type: 'HANG_CONFIRMATION',
      push,
      noMqtt: true,
      recipientId: author.id,
      data: value,
    };

    (env === 'local') ? await sendAlert(pushAuthor) : sendAlert(pushAuthor);
  }

  const mqttHangUsers = {
    sender: user,
    type: 'HANG_CONFIRMATION',
    push: null,
    data: value,
  };

  (env === 'local')
    ? await hang.notifyHangUsers(mqttHangUsers)
    : hang.notifyHangUsers(mqttHangUsers);

  let promises = [], thought, thoughtHit;

  if (hang.createdFromThoughtId) {
    [
      thought,
      thoughtHit,
    ] = await Promise.all([
      ThoughtModel.scope('displayGeneric').findByPk(hang.createdFromThoughtId),
      ThoughtHitModel.findOne({
        where: {
          thoughtId: hang.createdFromThoughtId,
          userId: user.id,
        },
      }),
    ]);
  }

  const userTrack = {
    userId: user.id,
    event: 'Changed Hang Confirmation',
    properties: {
      thoughtId: hang.createdFromThoughtId,
      thought: thought
        ? getThoughtBasics(thought.toJSON())
        : null,
      thoughtHit: thoughtHit ? thoughtHit.toJSON() : null,
      isConfirmed,
      confirmedAt: userHangData.confirmedAt,
      hang: hangBasics,
      byHangAuthor: (user.id === hang.authorId),
    },
  };

  promises.push(analytics.track(userTrack));

  if (user.id !== hang.author.id) {
    const authorTrack = {
      userId: hang.author.id,
      event: 'Hang Confirmation Received',
      properties: {
        thoughtId: hang.createdFromThoughtId,
        thought: thought
          ? getThoughtBasics(thought.toJSON())
          : null,
        thoughtHit: thoughtHit ? thoughtHit.toJSON() : null,
        isConfirmed,
        confirmedAt: userHangData.confirmedAt,
        hang: hangBasics,
        byHangAuthor: (user.id === hang.authorId),
      },
    };

    promises.push(analytics.track(authorTrack));
  }

  (env === 'local') ? await Promise.all(promises) : Promise.all(promises);

  return response.respond(204);
}));

module.exports = router;
