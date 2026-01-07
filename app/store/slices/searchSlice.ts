import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import {
  SearchPayload,
  SearchStateType,
  ClearSearchPayloadKey,
  SearchKey,
  ApiSearchKey,
  SetApiSearchPayload,
  SetSelectedValuePayload,
  ClearSelectedValuePayload,
} from 'types/index';

const initialState: SearchStateType = {
  categoryPicker: {query: ''},
  chatList: {query: ''},
  googlePlaceResults: {query: '', searchResults: null, selectedValue: null},
};

const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    search: (
      state: SearchStateType,
      {payload}: PayloadAction<SearchPayload>,
    ) => {
      return {...state, ...payload};
    },
    clearSearch: (
      state: SearchStateType,
      {payload}: PayloadAction<ClearSearchPayloadKey>,
    ) => {
      const isAnApiSearch = typeof state[payload] === 'string';

      if (isAnApiSearch) {
        state[payload as SearchKey].query = '';
      } else {
        state[payload as ApiSearchKey] = {query: '', searchResults: null};
      }
    },
    setApiSearchResults: (
      state: SearchStateType,
      {payload}: PayloadAction<SetApiSearchPayload>,
    ) => {
      const {query, searchKey, searchResults} = payload;

      state[searchKey].query = query;
      state[searchKey].searchResults = searchResults;
    },
    setSelectedValue: (
      state: SearchStateType,
      {payload}: PayloadAction<SetSelectedValuePayload>,
    ) => {
      const {searchKey, selectedValue} = payload;

      state[searchKey].selectedValue = selectedValue;
    },
    clearSelectedValue: (
      state: SearchStateType,
      {payload}: PayloadAction<ClearSelectedValuePayload>,
    ) => {
      const searchKey = payload;

      if (
        typeof state[searchKey] === 'object' &&
        state[searchKey] &&
        'selectedValue' in state[searchKey]
      ) {
        state[searchKey as ApiSearchKey].selectedValue = null;
      }
    },
  },
});

export const {
  search,
  clearSearch,
  setApiSearchResults,
  setSelectedValue,
  clearSelectedValue,
} = searchSlice.actions;

export default searchSlice;
