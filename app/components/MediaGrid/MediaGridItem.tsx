import React, {FC} from 'react';
import {Pressable, ActivityIndicator, Text, View, Image} from 'react-native';
import FastImage from 'react-native-fast-image';
import {useAppDispatch, useAppSelector} from 'hooks/index';
import {
  selectIsMediaUploading,
  selectMediaUploadError,
  selectMediaId,
  selectUploadingMediaUri,
} from 'store/selectors/media';
import styles from './styles';
import {MediaKey, UploadMediaStateType, RequestResponse} from 'types/index';
import {getMediaTypeFromUrl} from 'helpers/Utils';
import VideoThumbnail from 'ui/Elements/VideoThumnail';
import {typography} from 'src/styles/typography';
import {apiUploadMedia} from 'store/dispatches/media';

export interface RetryArgs {
  index: number;
  mediaId: number;
}

type MediaGridItemType = {
  media: UploadMediaStateType;
  index: number;
  mediaKey: MediaKey;
  onRetry: (args: RetryArgs) => void;
  onMediaPress: (mediaId: number) => void;
};

const MediaGridItem: FC<MediaGridItemType> = ({
  // media,
  index,
  mediaKey,
  onRetry,
  onMediaPress,
}) => {
  const dispatch = useAppDispatch();
  const isLoading = useAppSelector(state =>
    selectIsMediaUploading(state, mediaKey, index),
  );
  const isError = useAppSelector(state =>
    selectMediaUploadError(state, mediaKey, index),
  );
  const mediaId = useAppSelector(state =>
    selectMediaId(state, mediaKey, index),
  );

  const mediaUri = useAppSelector(state =>
    selectUploadingMediaUri(state, mediaKey, index),
  );

  const onPress = async () => {
    const didFailOnHighlight = !!mediaId;

    // failed on /media
    if (isError && !didFailOnHighlight) {
      const onSuccess = (response: RequestResponse) => {
        const {id} = response.body;

        onRetry({index, mediaId: id});
      };

      await dispatch(apiUploadMedia(mediaUri, mediaKey, index, onSuccess));
      return;
    }

    // failed on uploading to endpoint after /media
    if (isError && didFailOnHighlight) {
      onRetry({index, mediaId});
      return;
    }
    if (mediaId) {
      onMediaPress(mediaId);
      return;
    }
  };

  const mediaType = getMediaTypeFromUrl(mediaUri);

  return (
    <Pressable
      disabled={isLoading}
      onPress={onPress}
      style={styles.highlightContainer}>
      {(isLoading || isError) && (
        <View style={isError ? styles.errorOverlay : styles.overlay} />
      )}
      {isLoading ? (
        <ActivityIndicator style={styles.spin} size="small" color="white" />
      ) : (
        isError && (
          <Text
            style={[
              styles.errorButtonText,
              typography.smallBold,
              typography.textColorGreyWhite,
            ]}>
            Upload Failed {'\n'} Tap to retry
          </Text>
        )
      )}

      {mediaType === 'video' ? (
        <View style={styles.highlight}>
          <View style={styles.playIconContainer}>
            <View style={styles.playIconOverlay} />
            <Image
              style={styles.playIcon}
              source={require('assets/icons/play.png')}
            />
          </View>
          <VideoThumbnail videoUri={mediaUri} />
        </View>
      ) : (
        <FastImage
          style={styles.highlight}
          source={{uri: mediaUri}}
          resizeMode="cover"
        />
      )}
    </Pressable>
  );
};

export default MediaGridItem;
