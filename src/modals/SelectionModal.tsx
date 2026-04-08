import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal, type ModalButtonConfig } from "../components/ui/Modal";
import { styles } from "./SelectionModal.styles";

type SelectionModalProps = {
  visible: boolean;
  headline: string;
  content: string;
  options: string[];
  selectedValue?: string | null;
  onSelect: (value: string | null) => void;
};

export function SelectionModal(props: SelectionModalProps): React.JSX.Element {
  const { visible, headline, content, options, selectedValue, onSelect } =
    props;
  const fallbackSelection = useMemo(
    () => selectedValue ?? options[0] ?? null,
    [options, selectedValue],
  );
  const [selected, setSelected] = useState<string | null>(fallbackSelection);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setSelected(fallbackSelection);
  }, [fallbackSelection, visible]);

  const buttons: ModalButtonConfig[] = [
    {
      label: "Cancel",
      variant: ButtonVariant.Secondary,
      onPress: () => onSelect(null),
    },
    {
      label: "Use",
      variant: ButtonVariant.Primary,
      onPress: () => onSelect(selected),
      disabled: selected == null,
    },
  ];

  return (
    <Modal
      visible={visible}
      headline={headline}
      buttonConfig={buttons}
      onRequestClose={() => onSelect(null)}>
      <Label title={content} variant={LabelVariant.Normal} />
      <View style={styles.optionsContainer}>
        {options.map(option => {
          const isActive = option === selected;
          return (
            <Pressable
              key={option}
              onPress={() => setSelected(option)}
              style={styles.optionRow}>
              <View
                style={[
                  styles.radioOuter,
                  isActive
                    ? styles.radioOuterActive
                    : styles.radioOuterInactive,
                ]}>
                {isActive ? <View style={styles.radioInnerDot} /> : null}
              </View>
              <Label title={option} variant={LabelVariant.Normal} />
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
