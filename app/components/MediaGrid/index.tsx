import React from 'react';
import {View} from 'react-native';
import styles from './styles';

export interface ComponentType {
  key: string;
  component: JSX.Element;
}

interface MediaGridProps {
  viewModel: () => {
    rows: ComponentType[][];
  };
}

const MediaGrid: React.FC<MediaGridProps> = ({viewModel}) => {
  const {rows} = viewModel();

  return (
    <View style={styles.container}>
      <View style={styles.gridContainer}>
        {rows.map(currentRow => (
          <View key={currentRow[0].key} style={styles.rowContainer}>
            {currentRow.map(({component}) => component)}
          </View>
        ))}
      </View>
    </View>
  );
};

export default MediaGrid;
