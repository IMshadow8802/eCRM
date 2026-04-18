import AsyncStorage from '@react-native-async-storage/async-storage';
import Reactotron from 'reactotron-react-native';
import { reactotronReactQuery } from 'reactotron-react-query';
import { queryClient } from './src/services/queryClient';

if (__DEV__) {
  const reactotron = Reactotron
    .setAsyncStorageHandler(AsyncStorage)
    .configure({ name: 'eCRM Mobile' })
    .useReactNative({
      networking: {
        ignoreUrls: /symbolicate|logs|generate_204/,
      },
    })
    .use(reactotronReactQuery(queryClient))
    .connect();

  reactotron.clear();
  console.tron = reactotron;
}
