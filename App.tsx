/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { StatusBar, Text, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import HomeScreen from './src/screens/HomeScreen';
import AppsScreen from './src/screens/AppsScreen';
import StatsScreen from './src/screens/StatsScreen';
import { DashboardProvider } from './src/screens/DashboardContext';

Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.style = [
  { fontFamily: 'Poppins-Regular' },
  Text.defaultProps.style,
];

const Tab = createBottomTabNavigator();

function Tabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#101a12',
          borderTopColor: '#101a12',
          height: 64 + insets.bottom,
          paddingBottom: Math.max(10, insets.bottom),
          paddingTop: 8,
        },
        tabBarActiveTintColor: '#7cff7c',
        tabBarInactiveTintColor: '#9fb2a6',
        tabBarLabelStyle: { fontFamily: 'Poppins-SemiBold', fontSize: 10 },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Apps" component={AppsScreen} />
      <Tab.Screen name="Stats" component={StatsScreen} />
    </Tab.Navigator>
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <DashboardProvider>
        <NavigationContainer>
          <Tabs />
        </NavigationContainer>
      </DashboardProvider>
    </SafeAreaProvider>
  );
}

export default App;
