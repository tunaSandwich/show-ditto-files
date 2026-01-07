import React from 'react';
import {View} from 'react-native';
import styles from './styles';
import MediaGridItem, {RetryArgs} from './MediaGridItem';
import {UploadMediaStateType} from 'types/index';
import {MediaKey} from 'types/index';
import {ComponentType} from './index';

const itemsPerRow = 3;

const getKey = (media: UploadMediaStateType, index: number) =>
  `media_${media?.mediaId ?? media?.selectedMedia ?? index}`;

const addHighlightComponent = (
  mediaList: UploadMediaStateType[],
  index: number,
  mediaKey: MediaKey,
  onRetry: (args: RetryArgs) => void,
  onMediaPress: (mediaId: number) => void,
) => {
  const media = mediaList[index];

  if (media) {
    const key = getKey(media, index);

    return (
      <MediaGridItem
        key={key}
        media={media}
        index={index}
        mediaKey={mediaKey}
        onRetry={onRetry}
        onMediaPress={onMediaPress}
      />
    );
  }

  return <View key={index} style={styles.ghostPlaceholder} />;
};

export const getRows = (
  mediaList: UploadMediaStateType[],
  mediaKey: MediaKey,
  firstElement: JSX.Element | null = null,
  minimumNumRows = 5,
  onRetry: (args: RetryArgs) => void,
  onMediaPress: (mediaId: number) => void,
): ComponentType[][] => {
  const rows = [];
  let row = [];
  const numberOfHighlights = mediaList.length + 1; // + 1 is for the create
  let numberOfRows = Math.ceil(numberOfHighlights / itemsPerRow);

  if (numberOfRows < minimumNumRows) {
    numberOfRows = minimumNumRows;
  }

  for (let rowIndex = 0; rowIndex < numberOfRows; rowIndex++) {
    const isFirstRow = rowIndex === 0;

    let index = rowIndex * itemsPerRow;
    if (!isFirstRow) {
      index--;
    } // minus 1 for create

    if (isFirstRow && firstElement) {
      row.push({component: firstElement, key: 'create'});
    }

    while (row.length < itemsPerRow) {
      const key = getKey(mediaList[index], index);

      row.push({
        component: addHighlightComponent(
          mediaList,
          index,
          mediaKey,
          onRetry,
          onMediaPress,
        ),
        key,
      });
      index++;
    }

    rows.push(row);
    row = [];
  }

  return rows;
};
