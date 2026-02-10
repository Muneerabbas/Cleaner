import { Linking, PermissionsAndroid, Platform } from "react-native";

export async function requestStoragePermission() {
  if (Platform.OS !== "android") {
    return true;
  }

  if (
    Platform.Version >= 30 &&
    PermissionsAndroid.PERMISSIONS.MANAGE_EXTERNAL_STORAGE
  ) {
    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.MANAGE_EXTERNAL_STORAGE
    );

    if (status === PermissionsAndroid.RESULTS.GRANTED) {
      return true;
    }

    // For Android 11+ this permission is often granted via Settings.
    await Linking.openSettings();
    return false;
  }

  const perms = [];

  if (Platform.Version >= 33) {
    if (PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES) {
      perms.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    }
    if (PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO) {
      perms.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
    }
    if (PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO) {
      perms.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO);
    }
  } else if (PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE) {
    perms.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
  }

  if (perms.length === 0) {
    return true;
  }

  const results = await PermissionsAndroid.requestMultiple(perms);
  return perms.every(p => results[p] === PermissionsAndroid.RESULTS.GRANTED);
}
