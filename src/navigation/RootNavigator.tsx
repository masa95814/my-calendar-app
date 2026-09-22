import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useAuth } from "../auth/AuthProvider";
import AccountsScreen from "../screens/accounts";
import CalendarScreen from "../screens/calendar";
import LoginScreen from "../screens/login";
import RuleEditorScreen from "../screens/ruleEditor";
import RulesListScreen from "../screens/rules";
import SettingsScreen from "../screens/settings";
import type { RulesStackParamList, TabParamList } from "./types";

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
          component={CalendarScreen}
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
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: "設定",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

/** ログイン状態に応じて、ログイン画面かメインのタブを出す */
export default function RootNavigator() {
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

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F9FA",
  },
});
