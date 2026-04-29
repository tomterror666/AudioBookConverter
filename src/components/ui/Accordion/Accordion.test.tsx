/**
 * @format
 */
import "react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { describe, expect, it, jest } from "@jest/globals";
import renderer from "react-test-renderer";
import { Accordion } from "./Accordion";

function flattenStyle(input: unknown): Record<string, unknown> {
  return StyleSheet.flatten(input) as Record<string, unknown>;
}

describe("Accordion", () => {
  it("renders title inside the header", () => {
    const tree = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={() => {}}
        title={<Text testID="accordion-title">Section</Text>}>
        <View />
      </Accordion>,
    );
    const title = tree.root.findByProps({ testID: "accordion-title" });
    expect(title.props.children).toBe("Section");
  });

  it("does not render panel children when collapsed", () => {
    const tree = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={() => {}}
        title={<Text>T</Text>}>
        <View testID="panel-body" />
      </Accordion>,
    );
    expect(() => tree.root.findByProps({ testID: "panel-body" })).toThrow();
  });

  it("renders panel children when expanded", () => {
    const tree = renderer.create(
      <Accordion
        expanded
        onExpandedChange={() => {}}
        title={<Text>T</Text>}>
        <View testID="panel-body" />
      </Accordion>,
    );
    const panel = tree.root.findByProps({ testID: "panel-body" });
    expect(panel).toBeTruthy();
  });

  it("calls onExpandedChange with toggled value when header is pressed", () => {
    const onExpandedChange = jest.fn();
    const tree = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={onExpandedChange}
        title={<Text>T</Text>}>
        <View />
      </Accordion>,
    );
    const pressable = tree.root.findByType(Pressable);
    pressable.props.onPress();
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    tree.update(
      <Accordion
        expanded
        onExpandedChange={onExpandedChange}
        title={<Text>T</Text>}>
        <View />
      </Accordion>,
    );
    const pressableOpen = tree.root.findByType(Pressable);
    pressableOpen.props.onPress();
    expect(onExpandedChange).toHaveBeenCalledTimes(2);
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it("shows collapsed and expanded chevrons", () => {
    const closed = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={() => {}}
        title={<Text>T</Text>}>
        <View />
      </Accordion>,
    );
    const closedTexts = closed.root.findAllByType(Text);
    const chevronClosed = closedTexts.find(
      t => t.props.children === "\u25B6",
    );
    expect(chevronClosed).toBeTruthy();

    const open = renderer.create(
      <Accordion
        expanded
        onExpandedChange={() => {}}
        title={<Text>T</Text>}>
        <View />
      </Accordion>,
    );
    const openTexts = open.root.findAllByType(Text);
    const chevronOpen = openTexts.find(t => t.props.children === "\u25BC");
    expect(chevronOpen).toBeTruthy();
  });

  it("reflects expanded state on accessibilityState", () => {
    const collapsed = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={() => {}}
        title={<Text>T</Text>}>
        <View />
      </Accordion>,
    );
    expect(collapsed.root.findByType(Pressable).props.accessibilityState).toEqual(
      { expanded: false },
    );

    const expandedTree = renderer.create(
      <Accordion
        expanded
        onExpandedChange={() => {}}
        title={<Text>T</Text>}>
        <View />
      </Accordion>,
    );
    expect(
      expandedTree.root.findByType(Pressable).props.accessibilityState,
    ).toEqual({ expanded: true });
  });

  it("uses accessibilityRole button on header", () => {
    const tree = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={() => {}}
        title={<Text>T</Text>}>
        <View />
      </Accordion>,
    );
    expect(tree.root.findByType(Pressable).props.accessibilityRole).toBe(
      "button",
    );
  });

  it("applies custom titleChevronGap between title and chevron", () => {
    const tree = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={() => {}}
        title={<Text>T</Text>}
        titleChevronGap={72}>
        <View />
      </Accordion>,
    );
    const pressable = tree.root.findByType(Pressable);
    const innerViews = pressable.findAllByType(View);
    const gap = innerViews.find(
      v => flattenStyle(v.props.style).width === 72,
    );
    expect(gap).toBeTruthy();
  });

  it("passes outer style to root View", () => {
    const tree = renderer.create(
      <Accordion
        expanded={false}
        onExpandedChange={() => {}}
        title={<Text>T</Text>}
        style={{ marginTop: 99 }}>
        <View />
      </Accordion>,
    );
    const rootView = tree.root.findByType(View);
    const style = flattenStyle(rootView.props.style);
    expect(style.marginTop).toBe(99);
  });
});
