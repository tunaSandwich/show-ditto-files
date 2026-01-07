const AlbumModel = rootRequire('/models/Album');
const CategoryModel = rootRequire('/models/Category');
const FriendModel = rootRequire('/models/Friend');
const UserModel = rootRequire('/models/User');

const userAuthorize = rootRequire('/middlewares/users/authorize');
const Joi = require('joi');

const { teamDittoUserId } = rootRequire('/config/app');
const { Op } = Sequelize;

const {
  sortByDistanceTier,
  getDistanceTier,
  defaultRadiusKm,
  asyncHandler,
  getPerimeter,
  getBlocks,
  json,
} = rootRequire('/libs/helpers');

const {
  activeStatusSchema,
  safeLocationSchema,
  albumShallowSchema,
  idSchema,
} = rootRequire('/libs/schemas');

const router = express.Router({ mergeParams: true });

// POST - [ DEPRECATED ] - Post a hang draft to see suggested people to
// invite to the hang
router.post('/', userAuthorize);
router.post('/', asyncHandler(async (request, response) => {
  const { user } = request;

  const reqSchema = Joi.object({
    authorLocation: safeLocationSchema.required(),
    expiresAt: Joi.date().timestamp().iso().required(),
    categoryIds: Joi.array().min(0).max(5).unique().items(idSchema).required(),
  });

  const targetSchema = Joi.object({
    id: idSchema.required(),
    avatarThumbnailUrlCopy: Joi.string().uri().required(),
    avatarLargeUrlCopy: Joi.string().uri().required(),
    activeStatus: activeStatusSchema.required(),
    firstName: Joi.string().max(30).allow(null).required(),
    lastName: Joi.string().max(30).allow(null).required(),
    fullName: Joi.string().max(60).allow(null).required(),
    distanceTier: Joi.number().integer().min(0).max(8).allow(null).required(),
    albums: Joi.array().items(albumShallowSchema).required(),
  });

  const respSchema = Joi.object({
    categoryFriendsNearby: Joi.array().min(0).max(5).items(
      Joi.object({
        category: Joi.object({
          id: idSchema.required(),
          name: Joi.string().min(2).max(60).required(),
        }).required(),
        targets: Joi.array().items(targetSchema).required(),
      }),
    ).required(),
    categoryStrangersNearby: Joi.array().min(0).max(5).items(
      Joi.object({
        category: Joi.object({
          id: idSchema.required(),
          name: Joi.string().min(2).max(60).required(),
        }).required(),
        targets: Joi.array().items(targetSchema).required(),
      }),
    ).required(),
    generalFriendsNearby: Joi.array().items(targetSchema).required(),
    generalFriends: Joi.array().items(targetSchema).required(),
  });

  const reqError = reqSchema.validate(request.body).error;
  if (reqError) { return response.respond(400, reqError.message); }

  const { authorLocation, categoryIds } = request.body;

  const [
    categories,
    blocks,
    friendUserIds,
  ] = await Promise.all([
    getCategories(categoryIds),
    getBlocks(user),
    getFriendUserIds(user),
  ]);

  if (categories.length !== categoryIds.length) {
    return response.respond(404, 'Category not found for id');
  }

  await user.updateLocation({ location: authorLocation });

  const blockedOrBlocking = blocks.map(block => {
    return block.blockerUserId === user.id ?
      block.blockedUserId :
      block.blockerUserId;
  });

  const strangerUserIds = await getStrangerUserIds({ user, friendUserIds });
  const targetIds = friendUserIds.concat(strangerUserIds);
  const targets = await getTargets(targetIds);

  const filteredTargets = targets.filter(target =>
    !blockedOrBlocking.includes(target.id) &&
    !!target.firstName &&
    !!target.lastName,
  );

  const formatted = filteredTargets.map(target => {
    target.distanceTier = getDistanceTier({ subject: target, viewer: user });

    delete target.location;
    delete target.locationPermission;
    delete target.locationUpdatedAt;
    delete target.lastActiveAt;

    return target;
  });

  const categoryFriendsNearby = [];
  const categoryStrangersNearby = [];
  const generalFriendsNearby = [];
  const generalFriends = [];

  const friendsWithCat = {};
  const strangersWithCat = {};

  categories.forEach(category => {
    friendsWithCat[category.id] = [];
    strangersWithCat[category.id] = [];
  });

  formatted.forEach(target => {
    if (target.id === teamDittoUserId) return;
    let hasCat = false;

    if (friendUserIds.includes(target.id)) {
      if (target.distanceTier && target.distanceTier < 5) {
        if (target.albums && target.albums.length) {
          target.albums.forEach(a => {
            if (categoryIds.includes(a.categoryId)) {
              hasCat = true;
              friendsWithCat[a.categoryId].push(target);
            }
          });
        }

        if (!hasCat) generalFriendsNearby.push(target);
      }

      else generalFriends.push(target);
    }

    else {
      target.albums.forEach(a => {

        // TODO: truncate to 20 when frontend implementes "See All" button

        if (
          categoryIds.includes(a.categoryId)
          && strangersWithCat[a.categoryId].length < 10
          && target.distanceTier &&
          target.distanceTier < 5
        ) {
          strangersWithCat[a.categoryId].push(target);
        }
      });
    }

    delete target.interests;
  });

  categories.forEach(category => {
    categoryFriendsNearby.push({ category, targets: friendsWithCat[category.id] });
    categoryStrangersNearby.push({ category, targets: strangersWithCat[category.id] });
  });

  sortByDistanceTier(generalFriendsNearby);
  sortByDistanceTier(generalFriends);
  categoryFriendsNearby.forEach(list => sortByDistanceTier(list.targets));
  categoryStrangersNearby.forEach(list => sortByDistanceTier(list.targets));

  const resp = {
    categoryFriendsNearby,
    categoryStrangersNearby,
    generalFriendsNearby,
    generalFriends,
  };

  const value = validate(resp, respSchema);

  return response.respond(200, value);
}));

/* Helpers */

async function getCategories(ids) {
  const query = {
    where: { id: { [Op.in]: ids } },
    attributes: [ 'id', 'name' ],
  };

  const categories = await CategoryModel.findAll(query);
  return json(categories);
}

async function getFriendUserIds(user) {
  const query = {
    where: {
      status: 'active',
      [Op.or]: [ { initiatingUserId: user.id }, { targetUserId: user.id } ],
    },
  };

  return await FriendModel.findAll(query).then(friends => {
    friends = json(friends);

    return friends.map(friend => {
      return friend.initiatingUserId === user.id ?
        friend.targetUserId :
        friend.initiatingUserId;
    });
  });
}

async function getStrangerUserIds(options) {
  const { user, friendUserIds } = options;

  const lat = user.location.latitude;
  const lon = user.location.longitude;

  const perimeter = getPerimeter(lat, lon, defaultRadiusKm);
  const point = database.fn('ST_GEOMFROMTEXT', `POINT(${lon} ${lat})`);

  const distance = [
    database.fn('ST_DISTANCE_SPHERE', point, database.col('user.location')),
    'distance',
  ];

  // TODO: limit users using category id nested in user interest

  const idsToExclude = friendUserIds.concat([ user.id, teamDittoUserId ]);

  const query = {
    where: [
      { id: { [Op.notIn]: idsToExclude } },
      database.fn('MBRCONTAINS', perimeter, database.col('user.location')),
    ],
    having: [ { distance: { [Op.lte]: defaultRadiusKm * 1000 } } ],
    order: [ [ 'locationUpdatedAt', 'DESC' ] ],
    attributes: [ 'id', distance ],
  };

  const users = await UserModel.findAll(query);
  return json(users).map(u => u.id);
}

async function getTargets(userIds) {
  const targetQuery = {
    where: {
      id: { [Op.in]: userIds },
      isAlphaTester: true,
    },
    attributes: [
      'id',
      'avatarThumbnailUrlCopy',
      'avatarLargeUrlCopy',
      'activeStatus',
      'firstName',
      'lastName',
      'fullName',
      'location',
      'locationPermission',
      'locationUpdatedAt',
      'lastActiveAt',
    ],
    include: [
      {
        model: AlbumModel.scope('shallow'),
        as: 'albums',
      },
    ],
  };

  const users = await UserModel.unscoped().findAll(targetQuery);
  return json(users);
}

/* Export */

module.exports = router;
