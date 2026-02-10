import React, { useEffect, useState } from 'react';
import { View, Text, Button, FlatList } from 'react-native';
import { scanDirectory } from './src/native/FileScanner';
import { requestStoragePermission } from './src/utils/permissions';

export default function App() {
  const [files, setFiles] = useState([]);

  const load = async () => {
    await requestStoragePermission();
    const data = await scanDirectory('/storage/emulated/0/Download');
    setFiles(data);
  };

  return (
    <View>
      <Button title="Scan Storage" onPress={load} />
      <FlatList
        data={files}
        keyExtractor={i => i?.path}
        renderItem={({ item }: any) => (
          <Text>
            {item.name} - {Math.round(item.size / 1024 / 1024)}MB
          </Text>
        )}
      />
    </View>
  );
}
