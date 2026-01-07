/* eslint-disable react-hooks/exhaustive-deps */
import React, {useEffect} from 'react';
import {useAppDispatch, useAppSelector} from 'hooks/index';
import {selectMedia} from 'store/selectors/media';
import {Image} from 'react-native';
import UploadMediaButton from 'components/ui/Buttons/UploadMediaButton';
import {
  AlbumMediaKeyType,
  apiPostHighlight,
  setExistingMediaForGrid,
} from 'store/dispatches/albums/highlights';
import {getRows} from '../helpers';
import styles from '../styles';
import {selectNewlyCreatedAlbumId} from 'store/selectors/albums/createAlbum';
import {RetryArgs} from '../MediaGridItem';
import {
  CREATE_ALBUM_DELETE_HIGHLIGHT,
  CREATE_HIGHLIGHT_MOVE_BOTTOM,
  CREATE_HIGHLIGHT_MOVE_TOP,
} from 'constants/keyConstants/onPressKeys';
import {showOverlay} from 'store/slices/overlaysSlice';

const addHighlightButton = (
  <UploadMediaButton
    key="createAlbum"
    onPressKey="createAlbum"
    style={styles.addButton}>
    <Image style={styles.plus} source={require('assets/icons/PlusIcon.png')} />
  </UploadMediaButton>
);

export default () => {
  const dispatch = useAppDispatch();
  const mediaKey = 'createAlbum' as AlbumMediaKeyType;
  const media = useAppSelector(state => selectMedia(state, mediaKey));
  const albumId = useAppSelector(selectNewlyCreatedAlbumId) as number;
  const onRetry = ({index, mediaId}: RetryArgs) => {
    const data = {
      albumId,
      mediaId,
      position: index,
      mediaKey,
    };

    dispatch(apiPostHighlight(data));
  };

  const onMediaPress = (mediaId: number) => {
    dispatch(
      showOverlay({
        name: 'ActionSheet',
        data: {
          actions: [
            {
              icon: require('assets/icons/editor-align-top.png'),
              text: 'Send to top',
              destructive: false,
              onPressKey: CREATE_HIGHLIGHT_MOVE_TOP,
              metaData: {mediaId, albumId},
            },
            {
              icon: require('assets/icons/editor-align-bottom.png'),
              text: 'Send to bottom',
              destructive: false,
              onPressKey: CREATE_HIGHLIGHT_MOVE_BOTTOM,
              metaData: {mediaId, albumId},
            },
            {
              icon: require('assets/icons/DeleteTrashIcon.png'),
              text: 'Delete',
              destructive: true,
              onPressKey: CREATE_ALBUM_DELETE_HIGHLIGHT,
              metaData: {mediaId, albumId},
            },
          ],
          mediaId: media.mediaId,
        },
      }),
    );
  };
  const rows = getRows(
    media,
    mediaKey,
    addHighlightButton,
    5,
    onRetry,
    onMediaPress,
  );

  useEffect(() => {
    dispatch(setExistingMediaForGrid(mediaKey));
  }, []);

  return {
    rows,
  };
};
