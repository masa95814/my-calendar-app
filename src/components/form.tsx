import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

// 同期設定の編集フォームで使う小さな部品

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {help ? <Text style={styles.help}>{help}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function TextField(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor="#AAAAAA"
      {...props}
      style={[
        styles.input,
        props.multiline && styles.inputMultiline,
        props.style,
      ]}
    />
  );
}

export function SwitchRow({
  label,
  help,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  help?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.switchRow, disabled && styles.disabled]}>
      <View style={styles.switchLabel}>
        <Text style={styles.switchText}>{label}</Text>
        {help ? <Text style={styles.help}>{help}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

export type Option<T extends string | number> = {
  value: T;
  label: string;
  disabled?: boolean;
};

/** 単一選択（ラジオ相当） */
export function Choice<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => !option.disabled && onChange(option.value)}
            disabled={option.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: option.disabled }}
            style={[
              styles.chip,
              selected && styles.chipSelected,
              option.disabled && styles.disabled,
            ]}
          >
            <Text
              style={[styles.chipText, selected && styles.chipTextSelected]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 複数選択（チェックボックス相当） */
export function MultiChoice<T extends string>({
  options,
  values,
  onChange,
}: {
  options: readonly Option<T>[];
  values: readonly T[];
  onChange: (values: T[]) => void;
}) {
  const toggle = (value: T) => {
    onChange(
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value],
    );
  };
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = values.includes(option.value);
        return (
          <Pressable
            key={option.value}
            onPress={() => toggle(option.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text
              style={[styles.chipText, selected && styles.chipTextSelected]}
            >
              {selected ? "✓ " : ""}
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 色の選択。value が null のときは「既定」 */
export function ColorChoice({
  options,
  value,
  onChange,
  defaultLabel,
}: {
  options: readonly { id: string; label: string; hex: string }[];
  value: string | null;
  onChange: (value: string | null) => void;
  defaultLabel: string;
}) {
  const selectedLabel =
    value === null
      ? defaultLabel
      : (options.find((o) => o.id === value)?.label ?? value);
  return (
    <View>
      <View style={styles.swatches}>
        <Pressable
          onPress={() => onChange(null)}
          accessibilityRole="radio"
          accessibilityLabel={defaultLabel}
          accessibilityState={{ selected: value === null }}
          style={[
            styles.swatch,
            styles.swatchDefault,
            value === null && styles.swatchSelected,
          ]}
        >
          <Text style={styles.swatchDefaultText}>既定</Text>
        </Pressable>
        {options.map((option) => (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: value === option.id }}
            style={[
              styles.swatch,
              { backgroundColor: option.hex },
              value === option.id && styles.swatchSelected,
            ]}
          />
        ))}
      </View>
      <Text style={styles.help}>選択中: {selectedLabel}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  destructive,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        destructive && styles.buttonDestructive,
        (pressed || disabled) && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888888",
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionBody: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  field: {
    paddingVertical: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2D4150",
    marginBottom: 8,
  },
  help: {
    marginTop: 6,
    fontSize: 12,
    color: "#888888",
    lineHeight: 16,
  },
  error: {
    marginTop: 6,
    fontSize: 12,
    color: "#D0342C",
  },
  input: {
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#2D4150",
    backgroundColor: "#FAFAFA",
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  switchLabel: {
    flex: 1,
    paddingRight: 12,
  },
  switchText: {
    fontSize: 15,
    color: "#2D4150",
  },
  disabled: {
    opacity: 0.4,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#EFEFEF",
  },
  chipSelected: {
    backgroundColor: "#007AFF",
  },
  chipText: {
    fontSize: 14,
    color: "#2D4150",
  },
  chipTextSelected: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: "transparent",
  },
  swatchSelected: {
    borderColor: "#2D4150",
  },
  swatchDefault: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D0D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  swatchDefaultText: {
    fontSize: 10,
    color: "#666666",
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonDestructive: {
    backgroundColor: "#D0342C",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
