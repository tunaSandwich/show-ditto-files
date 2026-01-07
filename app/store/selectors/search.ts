import {createSelector} from 'reselect';
import {RootState, ApiSearchKey} from 'types/index';

const getSearchState = (state: RootState) => state.search;

export const selectSearchResults = createSelector(
  [
    getSearchState,
    (state: RootState, apiSearchKey: ApiSearchKey) => apiSearchKey,
  ],
  (search, apiSearchKey) => search[apiSearchKey].searchResults,
);

export const selectSelectedSearchValue = createSelector(
  [
    getSearchState,
    (_state: RootState, apiSearchKey: ApiSearchKey) => apiSearchKey,
  ],
  (search, apiSearchKey) => search[apiSearchKey].selectedValue,
);

export const selectHasSelectedSearchValue = createSelector(
  [
    getSearchState,
    (_state: RootState, apiSearchKey: ApiSearchKey) => apiSearchKey,
  ],
  (search, apiSearchKey) => !!search[apiSearchKey].selectedValue,
);
