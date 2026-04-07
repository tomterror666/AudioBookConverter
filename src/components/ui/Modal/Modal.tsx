import React from 'react';
import {Pressable, StyleSheet, Text, View, ViewStyle} from 'react-native';
import {Button, ButtonVariant} from '../Button';
import {Box} from '../Box';
import {Size} from '../constants';

export type ModalButtonConfig = {
  label: string;
  variant?: ButtonVariant;
  onPress: () => void;
  disabled?: boolean;
};

type ModalProps = {
  visible: boolean;
  headline?: string;
  content?: string;
  onRequestClose?: () => void;
  buttonConfig?: ModalButtonConfig[];
  children?: React.ReactNode;
  cardStyle?: ViewStyle;
};

export function Modal(props: ModalProps): React.JSX.Element | null {
  const {
    visible,
    headline,
    content,
    onRequestClose,
    buttonConfig = [],
    children,
    cardStyle,
  } = props;

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onRequestClose} />
      <View style={[styles.card, cardStyle]}>
        {headline ? <Text style={styles.headline}>{headline}</Text> : null}
        {content ? (
          <Box padding={{block: Size.size_16}}>
            <Text style={styles.content}>{content}</Text>
          </Box>
        ) : null}
        {children}
        {buttonConfig.length > 0 ? (
          <View style={styles.actionsRow}>
            {buttonConfig.map((cfg, idx) => (
              <Button
                key={`${cfg.label}-${idx}`}
                variant={cfg.variant ?? ButtonVariant.Primary}
                disabled={cfg.disabled}
                onPress={cfg.onPress}>
                {cfg.label}
              </Button>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 560,
    marginHorizontal: 24,
    zIndex: 2,
  },
  headline: {
    fontFamily: 'HelveticaNeue',
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
    textAlign: 'center',
  },
  content: {
    fontFamily: 'HelveticaNeue',
    fontSize: 15,
    color: '#1C1C1E',
    marginBottom: 12,
  },
  actionsRow: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
});
