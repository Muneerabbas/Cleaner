import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import HomeScreen from './src/screens/HomeScreen';
import ConnectedDevicesScreen from './src/screens/ConnectedDevicesScreen';
import DeviceActionScreen from './src/screens/DeviceActionScreen';
import ServerQrScannerScreen from './src/screens/ServerQrScannerScreen';
import AppsScreen from './src/screens/AppsScreen';
import StatsScreen from './src/screens/StatsScreen';
import CleanerHomeScreen from './src/screens/CleanerHomeScreen';
import CleanerListScreen from './src/screens/CleanerListScreen';
import DiskIntelScreen from './src/screens/DiskIntelScreen';
import DriveScreen from './src/screens/DriveScreen';
import { DashboardProvider } from './src/screens/DashboardContext';
import { colors, fonts } from './src/screens/styles';

Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.style = [
  { fontFamily: 'Poppins-Regular' },
  Text.defaultProps.style,
];

const Tab = createBottomTabNavigator();
const CleanerStack = createNativeStackNavigator();
const HomeStack = createNativeStackNavigator();

function HomeNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="ConnectedDevices" component={ConnectedDevicesScreen} />
      <HomeStack.Screen name="DeviceAction" component={DeviceActionScreen} />
      <HomeStack.Screen name="ServerQrScanner" component={ServerQrScannerScreen} />
    </HomeStack.Navigator>
  );
}

function CleanerNavigator() {
  return (
    <CleanerStack.Navigator screenOptions={{ headerShown: false }}>
      <CleanerStack.Screen name="CleanerHome" component={CleanerHomeScreen} />
      <CleanerStack.Screen name="CleanerList" component={CleanerListScreen} />
      <CleanerStack.Screen name="DiskIntel" component={DiskIntelScreen} />
      <CleanerStack.Screen name="DeviceAction" component={DeviceActionScreen} />
    </CleanerStack.Navigator>
  );
}

const TAB_ICONS: Record<string, { focused: string; unfocused: string }> = {
  Home: { focused: 'home', unfocused: 'home-outline' },
  Clean: { focused: 'broom', unfocused: 'broom' },
  Apps: { focused: 'apps', unfocused: 'apps' },
  Drive: { focused: 'google-drive', unfocused: 'google-drive' },
  Stats: { focused: 'chart-arc', unfocused: 'chart-arc' },
};

function Tabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 6,
          paddingTop: 6,
          elevation: 0,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: { fontFamily: fonts.semiBold, fontSize: 10, marginTop: 2 },
        tabBarIcon: ({ focused, color }) => {
          const icons = TAB_ICONS[route.name] || TAB_ICONS.Home;
          const name = focused ? icons.focused : icons.unfocused;
          return (
            <View style={focused ? {
              backgroundColor: 'rgba(92, 235, 107, 0.12)',
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 4,
            } : undefined}>
              <MaterialCommunityIcons name={name as any} size={22} color={color} />
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeNavigator} />
      <Tab.Screen name="Clean" component={CleanerNavigator} options={{ tabBarLabel: 'Clean' }} />
      <Tab.Screen name="Apps" component={AppsScreen} />
      <Tab.Screen name="Drive" component={DriveScreen} options={{ tabBarLabel: 'Drive' }} />
      <Tab.Screen name="Stats" component={StatsScreen} />
    </Tab.Navigator>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <DashboardProvider>
        <NavigationContainer>
          <Tabs />
        </NavigationContainer>
      </DashboardProvider>
    </SafeAreaProvider>
  );
}

export default App;
