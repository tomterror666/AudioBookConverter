import React from "react";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";

type EmbedChaptersInM4aModalProps = {
  visible: boolean;
  content: string;
  onContinue: () => void;
};

export function EmbedChaptersInM4aModal(
  props: EmbedChaptersInM4aModalProps,
): React.JSX.Element {
  const { visible, content, onContinue } = props;
  return (
    <Modal
      visible={visible}
      headline="Embed Chapters in M4A"
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
