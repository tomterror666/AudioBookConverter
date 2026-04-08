import "react-native";
import React from "react";
import { Pressable, Text } from "react-native";
import { describe, expect, it, jest } from "@jest/globals";
import renderer from "react-test-renderer";
import { Button, ButtonVariant } from "../Button";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("returns null when not visible", () => {
    const tree = renderer.create(
      <Modal visible={false} headline="Hidden">
        <Text>Body</Text>
      </Modal>,
    );
    expect(tree.toJSON()).toBeNull();
  });

  it("renders headline and children when visible", () => {
    const tree = renderer.create(
      <Modal visible headline="Hello">
        <Text>Body</Text>
      </Modal>,
    );
    const textNodes = tree.root.findAllByType(Text);
    expect(textNodes.some(node => node.props.children === "Hello")).toBe(true);
    expect(textNodes.some(node => node.props.children === "Body")).toBe(true);
  });

  it("renders buttonConfig and default variant", () => {
    const onOk = jest.fn();
    const tree = renderer.create(
      <Modal
        visible
        buttonConfig={[
          {
            label: "Cancel",
            variant: ButtonVariant.Secondary,
            onPress: () => {},
          },
          { label: "OK", onPress: onOk },
        ]}
      />,
    );
    const buttons = tree.root.findAllByType(Button);
    expect(buttons).toHaveLength(2);
    expect(buttons[0].props.variant).toBe(ButtonVariant.Secondary);
    expect(buttons[1].props.variant).toBe(ButtonVariant.Primary);
    buttons[1].props.onPress();
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("calls onRequestClose when backdrop is pressed", () => {
    const onRequestClose = jest.fn();
    const tree = renderer.create(
      <Modal visible onRequestClose={onRequestClose}>
        <Text>Body</Text>
      </Modal>,
    );
    const pressables = tree.root.findAllByType(Pressable);
    pressables[0].props.onPress();
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
});
