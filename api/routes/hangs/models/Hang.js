const MediaModel = rootRequire('/models/Media');
const UserModel = rootRequire('/models/User');
const UserHangDataModel = rootRequire('/models/UserHangData');
const crypto = require('crypto');

const { sendAlert } = rootRequire('/libs/alerts');
const { Op } = Sequelize;

const visibilities = [ 'public', 'friends', 'private' ];

const HangModel = database.define('hang', {
  id: {
    type: Sequelize.INTEGER(10).UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
  },
  authorId: {
    type: Sequelize.INTEGER(10).UNSIGNED,
    allowNull: false,
  },
  title: {
    type: Sequelize.STRING,
    validate: {
      len: {
        args: [ 1, 250 ],
        msg: 'Hang title cannot exceed 250 characters',
      },
    },
  },
  visibility: {
    type: Sequelize.STRING,
    allowNull: false,
    validate: {
      isIn: {
        args: [ visibilities ],
        msg: 'The visibility provided is invalid',
      },
    },
  },
  location: {
    type: Sequelize.GEOMETRY('POINT'),
    allowNull: false,
    get() {
      const location = this.getDataValue('location');
      const coordinates = (location)
        ? location.coordinates
        : undefined;

      return (coordinates && (coordinates.length === 2)) ? {
        latitude: coordinates[1],
        longitude: coordinates[0],
      } : undefined;
    },
    set(value) {
      value = value || { latitude: 0, longitude: 0 };

      this.setDataValue('location', {
        type: 'Point',
        coordinates: [ value.longitude, value.latitude ],
      });
    },
    defaultValue: () => {
      return {
        type: 'Point',
        coordinates: [ 0, 0 ],
      };
    },
  },
  expiresAt: {
    type: Sequelize.DATE(6),
    allowNull: true,
  },
  mediaId: {
    type: Sequelize.INTEGER(10).UNSIGNED,
    allowNull: true,
  },
  lastMessageId: {
    type: Sequelize.INTEGER(10).UNSIGNED,
  },
  lastMessageAt: {
    type: Sequelize.DATE(4),
    defaultValue: Sequelize.NOW,
  },
  usersCount: {
    type: Sequelize.INTEGER(10),
    defaultValue: 1,
  },
  isDistanced: {
    type: Sequelize.BOOLEAN,
    defaultValue: false,
  },
  isMasked: {
    type: Sequelize.BOOLEAN,
    defaultValue: false,
  },
  mediaCategoryId: {
    type: Sequelize.INTEGER(10).UNSIGNED,
    allowNull: true,
  },
  shareCode: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: () => {
      return crypto.randomBytes(7).toString('base64')
        .replace(/\+/g, 'a')
        .replace(/\//g, 'z')
        .replace(/=/g, '');
    },
  },
  minAge: {
    type: Sequelize.INTEGER(10).UNSIGNED,
    allowNull: true,
  },
  maxAge: {
    type: Sequelize.INTEGER(10).UNSIGNED,
    allowNull: true,
  },
  collegeDomain: {
    type: Sequelize.STRING,
    allowNull: true,
  },
  isShareable: {
    type: Sequelize.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  largestVisibility: {
    type: Sequelize.STRING,
    allowNull: false,
    validate: {
      isIn: {
        args: [ visibilities ],
        msg: 'The visibility provided is invalid',
      },
    },
  },
  createdFromThoughtId: {
    type: Sequelize.INTEGER(10).UNSIGNED,
    allowNull: true,
    defaultValue: null,
  },
  didHappen: {
    type: Sequelize.BOOLEAN,
    defaultValue: null,
    allowNull: true,
  },
}, {
  indexes: [
    {
      fields: [ 'authorId' ],
      unique: false,
    },
    {
      fields: [ 'location' ],
      type: 'SPATIAL',
    },
    {
      fields: [ 'expiresAt' ],
      unique: false,
    },
    /*{
      fields: [ 'location', 'expiresAt', 'visibility' ],
      unique: false,
    },*/
    {
      fields: [ 'shareCode' ],
      unique: true,
    },
    /*{
      fields: [
        'location',
        'expiresAt',
        'minAge',
        'maxAge',
        'collegeDomain',
      ],
      unique: false,
    },*/
  ],
  defaultScope: {},
  scopes: {
    unseen: () => ({
      attributes: [ 'id', 'lastMessageAt' ],
    }),
    hangMessagePreview: {
      attributes: [
        'id',
        'authorId',
        'title',
        'visibility',
        'location',
        'expiresAt',
        'usersCount',
        'createdAt',
        'isDistanced',
        'isMasked',
        'mediaCategoryId',
        'shareCode',
        'minAge',
        'maxAge',
        'collegeDomain',
        'isShareable',
        'didHappen',
      ],
      include: [
        {
          model: MediaModel.scope('standalone'),
          as: 'media',
        },
      ],
    },
    complete: (authUserId, rsvpStatuses) => ({
      attributes: [
        'id',
        'title',
        'visibility',
        'location',
        'expiresAt',
        'usersCount',
        'createdAt',
        'isDistanced',
        'isMasked',
        'mediaCategoryId',
        'shareCode',
        'minAge',
        'maxAge',
        'collegeDomain',
        'isShareable',
        'largestVisibility',
        'createdFromThoughtId',
        'didHappen',
      ],
      include: [
        {
          model: database.models.hangMessage.scope('withReactions'),
          as: 'hangMessages',
          where: { replyToMessageId: null },
          order: [ [ 'sentAt', 'DESC' ] ],
          limit: 50,
        },
        {
          model: database.models.userThreadData.scope('defaultScope'),
          as: 'threads',
          limit: 500,
          where: { userId: authUserId },
          order: [ [ 'lastReplySentAt', 'DESC' ] ],
        },
        {
          model: database.models.category.scope('basics'),
          through: { attributes: [] },
        },
        {
          model: database.models.user.scope('hangChatUser'),
          as: 'author',
        },
        {
          model: database.models.media.scope('standalone'),
          as: 'media',
        },
        {
          model: database.models.user.scope('base'),
          as: 'participants',
          through: {
            model: database.models.userHangData,
            where: { rsvp: rsvpStatuses },
          },
        },
        {
          model: database.models.userHangData,
          as: 'authUserHangData',
          where: { userId: authUserId },
          required: false,
        },
      ],
    }),
    withCategories: {
      include: [
        {
          model: database.models.category.scope('basics'),
          through: { attributes: [] },
        },
      ],
    },
    preview: rsvpStatuses => ({
      attributes: [
        'id',
        'title',
        'visibility',
        'location',
        'expiresAt',
        'usersCount',
        'createdAt',
        'isDistanced',
        'isMasked',
        'mediaCategoryId',
        'shareCode',
        'minAge',
        'maxAge',
        'collegeDomain',
        'isShareable',
        'createdFromThoughtId',
        'didHappen',
      ],
      include: [
        {
          model: database.models.category.scope('basics'),
          through: { attributes: [] },
        },
        {
          model: database.models.user.scope('hangChatUser'),
          as: 'author',
        },
        {
          model: database.models.media.scope('standalone'),
          as: 'media',
        },
        {
          model: database.models.user.scope('defaultScope'),
          as: 'participants',
          through: {
            model: database.models.userHangData,
            where: { rsvp: rsvpStatuses },
            limit: 10, // TODO: this is not supported
          },
        },
      ],
    }),
    previewPrivate: rsvpStatuses => ({
      attributes: [
        'id',
        'title',
        'visibility',
        'location',
        'expiresAt',
        'usersCount',
        'createdAt',
        'isDistanced',
        'isMasked',
        'mediaCategoryId',
        'shareCode',
        'minAge',
        'maxAge',
        'collegeDomain',
        'isShareable',
        'didHappen',
      ],
      include: [
        {
          model: database.models.category.scope('basics'),
          through: { attributes: [] },
        },
        {
          model: database.models.user.scope('hangChatUser'),
          as: 'author',
        },
        {
          model: database.models.media.scope('standalone'),
          as: 'media',
        },
        {
          model: database.models.user.scope('defaultScope'),
          as: 'participants',
          through: {
            model: database.models.userHangData,
            where: { rsvp: rsvpStatuses },
            limit: 10, // TODO: this is not supported
          },
        },
      ],
    }),
    listPreview: authUserId => ({
      attributes: [
        'id',
        'title',
        'visibility',
        'expiresAt',
        'usersCount',
        'mediaCategoryId',
        'createdFromThoughtId',
      ],
      include: [
        {
          model: UserModel.scope('hangChatUser'),
          as: 'author',
        },
        {
          model: database.models.media.scope('standalone'),
          as: 'media',
        },
        {
          model: database.models.hangMessage.scope('preview'),
          as: 'lastMessage',
        },
        {
          model: database.models.userHangData,
          as: 'authUserHangData',
          where: { userId: authUserId },
        },
        {
          model: database.models.userThreadData.unscoped(),
          as: 'unreadThreads',
          required: false,
          attributes: [
            'replyToMessageId',
            'lastReadAt',
            'lastReplySentAt',
          ],
          order: [ [ 'lastReplySentAt', 'DESC' ] ],
          where: {
            userId: authUserId,
            lastReadAt: { [Op.lt]: Sequelize.col('lastReplySentAt') },
          },
        },
      ],
    }),
    hangInThought: {
      attributes: [
        'id',
        'authorId',
        'title',
        'visibility',
        'location',
        'expiresAt',
        'usersCount',
        'createdAt',
        'mediaCategoryId',
        'shareCode',
        'minAge',
        'maxAge',
        'collegeDomain',
        'isShareable',
        'largestVisibility',
        'createdFromThoughtId',
        'didHappen',
      ],
      include: [
        {
          model: UserModel.scope('withLocation'),
          as: 'author',
          include: [
            {
              model: UserHangDataModel,
              as: 'userHangData',
            },
          ],
        },
        {
          model: database.models.media.scope('standalone'),
          as: 'media',
        },
      ],
    },
  },
});

HangModel.addHook('afterCreate', (hang, options) => {
  const HangMessageModel = database.models.hangMessage;

  const fields = {
    sentAt: hang.createdAt,
    hangId: hang.id,
    userId: hang.authorId,
    type: 'CREATE',
  };

  const opt = { transaction: options.transaction };

  return HangMessageModel.create(fields, opt).then(hangMessage => {
    hang.lastMessageId = hangMessage.id;
    return hang.save();
  });
});

HangModel.prototype.notifyHangUsers = async function(options) {
  const { sender, type, push, data } = options;

  if (!sender) throw new Error('Missing sender on notifyHangUsers');

  const query = {
    attributes: [ 'id', 'accessToken', 'badgeCount' ],
    through: {
      model: database.models.userHangData,
      where: { rsvp: 'joined' },
    },
  };

  const joinedUsers = await this.getParticipants(query);

  const promises = [];

  joinedUsers.forEach(user => {
    const alert = {
      type,
      push: null,
      recipientId: user.id,
      data,
    };

    const wantsPush = !!(
      user.id !== sender.id
      && !user.userHangData.isMuted
      && user.userHangData.lastReadAt
    );

    if (push && wantsPush) alert.push = push;

    promises.push(sendAlert(alert));
  });

  (env === 'local') ? await Promise.all(promises) : Promise.all(promises);
};

HangModel.addHook('afterDestroy', async instance => {
  const [
    count,
    media,
  ] = await Promise.all([
    HangModel.count({ where: { mediaId: instance.mediaId } }),
    MediaModel.findByPk(instance.mediaId),
  ]);

  if (count === 0 && media) await media.destroy();
});

module.exports = HangModel;
