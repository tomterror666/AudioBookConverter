import React from "react";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";
import { useUiCopy } from "../UiLocaleContext";

type DetermineChapterPositionsModalProps = {
  visible: boolean;
  headline: string;
  content: string;
  onContinue: () => void;
};

export function DetermineChapterPositionsModal(
  props: DetermineChapterPositionsModalProps,
): React.JSX.Element {
  const { visible, headline, content, onContinue } = props;
  const u = useUiCopy();
  return (
    <Modal
      visible={visible}
      headline={headline}
      buttonConfig={[
        {
          label: u.mp3Modal.continue,
          variant: ButtonVariant.Primary,
          onPress: onContinue,
        },
      ]}
      onRequestClose={onContinue}>
      <Label title={content} variant={LabelVariant.Normal} />
    </Modal>
  );
}
