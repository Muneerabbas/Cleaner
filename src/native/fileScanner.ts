import { NativeModules } from 'react-native';

const { FileScanner } = NativeModules;

export const scanDirectory = (path: string) => {
  return FileScanner.scan(path);
};
