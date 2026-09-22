import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AuthProvider, useAuth } from "../auth/AuthProvider";
import type { RulesStackParamList, TabParamList } from "../navigation/types";
import AccountsScreen from "./accounts";
import CalendarComponent from "./calendar";
import LoginScreen from "./login";
import RuleEditorScreen from "./ruleEditor";
import RulesListScreen from "./rules";

const Tab = createBottomTabNavigator<TabParamList>();
const RulesStack = createNativeStackNavigator<RulesStackParamList>();

function RulesNavigator() {
  return (
    <RulesStack.Navigator
      screenOptions={{ headerTitleStyle: { fontWeight: "600" } }}
    >
      <RulesStack.Screen
        name="RulesList"
        component={RulesListScreen}
        options={{ title: "同期設定" }}
      />
      <RulesStack.Screen
        name="RuleEditor"
        component={RuleEditorScreen}
        options={{ title: "同期設定", headerBackTitle: "戻る" }}
      />
    </RulesStack.Navigator>
  );
}

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
          name="Rules"
          component={RulesNavigator}
          options={{
            title: "同期設定",
            // スタック側のヘッダーを使う
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name="swap-horizontal-outline"
                color={color}
                size={size}
              />
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
