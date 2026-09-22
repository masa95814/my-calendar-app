import { StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";

import CalendarComponent from "./calendar";

const App = () => {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <CalendarComponent />
      </SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
});

registerRootComponent(App);
