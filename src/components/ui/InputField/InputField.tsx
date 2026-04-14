/**
 * Read-only, pressable field that looks like a text input (folder picker, etc.).
 *
 * @format
 */

import React from "react";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { styles } from "./InputField.styles";

export type InputFieldProps = {
  /** Layout wrapper (e.g. row-specific margins); merged with outline. */
  wrapperStyle?: StyleProp<ViewStyle>;
  onPress: () => void;
  value: string | null | undefined;
  placeholder: string;
  numberOfLines?: number;
  ellipsizeMode?: TextProps["ellipsizeMode"];
};

export function InputField(props: InputFieldProps): React.JSX.Element {
  const {
    wrapperStyle,
    onPress,
    value,
    placeholder,
    numberOfLines,
    ellipsizeMode,
  } = props;
  const display = value ?? placeholder;
  const usePlaceholderStyle = !value;

  return (
    <View style={[styles.outline, wrapperStyle]}>
      <Pressable style={styles.pressable} onPress={onPress}>
        <Text
          style={[styles.text, usePlaceholderStyle && styles.placeholder]}
          numberOfLines={numberOfLines}
          ellipsizeMode={ellipsizeMode}>
          {display}
        </Text>
      </Pressable>
    </View>
  );
}
