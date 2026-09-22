import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";

import { AuthProvider, useAuth } from "../auth/AuthProvider";
import AccountsScreen from "./accounts";
import CalendarComponent from "./calendar";
import LoginScreen from "./login";

type TabParamList = {
  Calendar: undefined;
  Accounts: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

function MainTabs() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          tabBarActiveTintColor: "#007AFF",
          headerTitleStyle: { fontWeight: "600" },
        }}
      >
        <Tab.Screen
          name="Calendar"
          component={CalendarComponent}
          options={{
            title: "カレンダー",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Accounts"
          component={AccountsScreen}
          options={{
            title: "アカウント",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="people-outline" color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function Root() {
  const { user, initializing } = useAuth();
  if (initializing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  return user ? <MainTabs /> : <LoginScreen />;
}

const App = () => {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F9FA",
  },
});

registerRootComponent(App);
