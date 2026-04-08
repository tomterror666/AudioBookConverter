import React from "react";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";

type DetermineChapterPositionsModalProps = {
  visible: boolean;
  content: string;
  onContinue: () => void;
};

export function DetermineChapterPositionsModal(
  props: DetermineChapterPositionsModalProps,
): React.JSX.Element {
  const { visible, content, onContinue } = props;
  return (
    <Modal
      visible={visible}
      headline="Determine Chapter Positions"
      buttonConfig={[
        {
          label: "Continue",
          variant: ButtonVariant.Primary,
          onPress: onContinue,
        },
      ]}
      onRequestClose={onContinue}>
      <Label title={content} variant={LabelVariant.Normal} />
    </Modal>
  );
}
