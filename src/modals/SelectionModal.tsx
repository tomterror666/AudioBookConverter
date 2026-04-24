import React, { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal, type ModalButtonConfig } from "../components/ui/Modal";
import { Color } from "../constants";
import { useUiCopy } from "../UiLocaleContext";
import { styles } from "./SelectionModal.styles";

const RADIO_PX = 16;
const RADIO_R_STROKE = 2;
const RADIO_R_RING = 7;
const RADIO_R_DOT = 4;

/** Ring + dot drawn in SVG — RN macOS often drops `View` borders inside `Pressable`. */
function RadioGlyph(props: { active: boolean }): React.JSX.Element {
  const { active } = props;
  const half = RADIO_PX / 2;
  return (
    <View style={styles.radioGlyphWrap}>
      <Svg width={RADIO_PX} height={RADIO_PX}>
        <Circle
          cx={half}
          cy={half}
          r={RADIO_R_RING}
          fill={Color.white}
          stroke={active ? Color.primary : Color.gray500}
          strokeWidth={RADIO_R_STROKE}
        />
        {active ? (
          <Circle cx={half} cy={half} r={RADIO_R_DOT} fill={Color.primary} />
        ) : null}
      </Svg>
    </View>
  );
}

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
  const u = useUiCopy();
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
      label: u.selection.cancel,
      variant: ButtonVariant.Secondary,
      onPress: () => onSelect(null),
    },
    {
      label: u.selection.use,
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
              <RadioGlyph active={isActive} />
              <Label title={option} variant={LabelVariant.Normal} />
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
