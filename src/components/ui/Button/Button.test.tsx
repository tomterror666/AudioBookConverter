import "react-native";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { describe, expect, it } from "@jest/globals";
import renderer from "react-test-renderer";
import { Button, ButtonSize, ButtonVariant } from "./Button";

function flattenStyle(input: unknown): Record<string, unknown> {
  return StyleSheet.flatten(input) as Record<string, unknown>;
}

describe("Button", () => {
  it("renders children text", () => {
    const tree = renderer.create(<Button>Save</Button>);
    const textNode = tree.root.findByType(Text);
    expect(textNode.props.children).toBe("Save");
  });

  it("disables pressable when disabled", () => {
    const tree = renderer.create(<Button disabled>Save</Button>);
    const pressableNode = tree.root.findByType(Pressable);
    expect(pressableNode.props.disabled).toBe(true);
  });

  it("shows loading indicator and hides text when loading", () => {
    const tree = renderer.create(<Button isLoading>Save</Button>);
    expect(() => tree.root.findByType(Text)).toThrow();
    const spinner = tree.root.findByType(ActivityIndicator);
    expect(spinner.props.size).toBe("small");
  });

  it("applies small size spacing", () => {
    const tree = renderer.create(<Button size={ButtonSize.Small}>Save</Button>);
    const pressableNode = tree.root.findByType(Pressable);
    const style = flattenStyle(pressableNode.props.style);
    expect(style.paddingVertical).toBe(6);
    expect(style.paddingHorizontal).toBe(10);
  });

  it("uses secondary variant style", () => {
    const tree = renderer.create(
      <Button variant={ButtonVariant.Secondary}>Save</Button>,
    );
    const pressableNode = tree.root.findByType(Pressable);
    const style = flattenStyle(pressableNode.props.style);
    expect(style.backgroundColor).toBe("#eeeeee");
  });
});
