/**
 * @format
 */

import "react-native";
import React from "react";
import { Text } from "react-native";
import { describe, expect, it, jest } from "@jest/globals";
import renderer from "react-test-renderer";
import { InputField } from "./InputField";

describe("InputField", () => {
  it("renders placeholder text and style when value is empty", () => {
    const tree = renderer.create(
      <InputField
        onPress={jest.fn()}
        value={null}
        placeholder="AudioBooks"
      />,
    );
    const texts = tree.root.findAllByType(Text);
    expect(texts[0].props.children).toBe("AudioBooks");
  });

  it("renders value when set", () => {
    const tree = renderer.create(
      <InputField
        onPress={jest.fn()}
        value="/path/to/book"
        placeholder="AudioBooks"
        numberOfLines={1}
        ellipsizeMode="middle"
      />,
    );
    const texts = tree.root.findAllByType(Text);
    expect(texts[0].props.children).toBe("/path/to/book");
  });
});
