import {isErroredResponse} from 'helpers/Utils';
import {AppThunk, RequestResponse} from 'types/index';
import {setApiSearchResults} from '../slices/searchSlice';
import {loading, error, success} from 'store/slices/requestStatusSlice';
import Api from './api';

export const apiSearchUsersContacts =
  (query: string): AppThunk<Promise<void>> =>
  async dispatch => {
    dispatch(loading('googlePlaceResults'));

    const path = `/places/search?searchString=${query}`;

    const response = await dispatch(Api.get({path}));

    if (!isErroredResponse(response)) {
      const searchResults = (response as RequestResponse).body
        .googlePlaceResults;

      dispatch(
        setApiSearchResults({
          query,
          searchKey: 'googlePlaceResults',
          searchResults,
        }),
      );
      dispatch(success('googlePlaceResults'));
    } else {
      const err = typeof response === 'string' ? response : 'an error occured';

      dispatch(error({key: 'googlePlaceResults', error: err}));
    }
  };
