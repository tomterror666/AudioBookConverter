import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {Color} from '../constants';

export enum ButtonVariant {
  Primary = 'primary',
  Secondary = 'secondary',
  Tertiary = 'tertiary',
  Text = 'text',
  Ghost = 'ghost',
  Destructive = 'destructive',
}

type ButtonProps = {
  children: React.ReactNode;
  variant?: ButtonVariant;
  onPress?: () => void;
  disabled?: boolean;
};

export function Button(props: ButtonProps): React.JSX.Element {
  const {children, variant = ButtonVariant.Primary, onPress, disabled = false} =
    props;
  const textStyleByVariant = (() => {
    switch (variant) {
      case ButtonVariant.Secondary:
      case ButtonVariant.Tertiary:
      case ButtonVariant.Ghost:
        return styles.textDark;
      case ButtonVariant.Text:
      case ButtonVariant.Destructive:
      case ButtonVariant.Primary:
      default:
        return styles.textLight;
    }
  })();

  const buttonStyleByVariant = (() => {
    switch (variant) {
      case ButtonVariant.Secondary:
        return styles.buttonSecondary;
      case ButtonVariant.Tertiary:
        return styles.buttonTertiary;
      case ButtonVariant.Text:
        return styles.buttonTextVariant;
      case ButtonVariant.Ghost:
        return styles.buttonGhost;
      case ButtonVariant.Destructive:
        return styles.buttonDestructive;
      case ButtonVariant.Primary:
      default:
        return styles.buttonPrimary;
    }
  })();

  return (
    <Pressable
      style={[styles.buttonBase, buttonStyleByVariant, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={onPress}>
      <Text style={[styles.textBase, textStyleByVariant, disabled && styles.textDisabled]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonPrimary: {
    backgroundColor: Color.primary,
  },
  buttonSecondary: {
    backgroundColor: Color.gray200,
  },
  buttonTertiary: {
    backgroundColor: Color.surfaceLight,
    borderWidth: 1,
    borderColor: Color.borderLight,
  },
  buttonTextVariant: {
    backgroundColor: Color.transparent,
  },
  buttonGhost: {
    backgroundColor: Color.transparent,
    borderWidth: 1,
    borderColor: Color.borderLight,
  },
  buttonDestructive: {
    backgroundColor: Color.destructive,
  },
  buttonDisabled: {
    backgroundColor: Color.textSecondaryDark,
  },
  textBase: {
    fontSize: 15,
    fontWeight: '600',
  },
  textLight: {
    color: Color.white,
  },
  textDark: {
    color: Color.textPrimaryLight,
  },
  textDisabled: {
    color: Color.surfaceLight,
  },
});
