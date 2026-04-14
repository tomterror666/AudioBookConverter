/**
 * AudioBookConverter App
 * @format
 */

import React from "react";
import { SafeAreaView } from "react-native";
import { AudiobookScreenBackground } from "./components/AudiobookScreenBackground";
import { MainPage } from "./components/MainPage/MainPage";
import { styles } from "./App.styles";

function App(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.container}>
      <AudiobookScreenBackground />
      <MainPage />
    </SafeAreaView>
  );
}

export default App;
