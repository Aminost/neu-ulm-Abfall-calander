import React from "react";
import { useFocusEffect } from "expo-router";
import { Share2 } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { Card, EmptyState, ScreenTitle } from "../../src/components/ui";
import { listDocuments } from "../../src/lib/storage";
import { colors, font, spacing } from "../../src/lib/theme";
import type { DocumentRecord, Entity, Relation } from "../../src/lib/types";

// A deterministic radial layout: dedup entities by name, weight node size by
// how often the entity appears, place nodes on a circle, draw relation edges.
// Simple and readable on a phone — no physics simulation needed.

const TYPE_COLORS: Record<string, string> = {
  person: "#6B5BD2",
  organization: "#2563A6",
  company: "#2563A6",
  date: "#C2410C",
  amount: "#2F6F5E",
  money: "#2F6F5E",
  invoice: "#B42318",
  account: "#0E7490",
};

function colorFor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? colors.textMuted;
}

interface GraphNode extends Entity {
  count: number;
}

function buildGraph(docs: DocumentRecord[]): { nodes: GraphNode[]; edges: Relation[] } {
  const nodeMap = new Map<string, GraphNode>();
  for (const doc of docs) {
    for (const e of doc.analysis.entities) {
      const key = e.name.trim().toLowerCase();
      if (!key) continue;
      const existing = nodeMap.get(key);
      if (existing) existing.count += 1;
      else nodeMap.set(key, { ...e, count: 1 });
    }
  }
  const nodes = [...nodeMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 16); // cap for legibility
  const present = new Set(nodes.map((n) => n.name.trim().toLowerCase()));
  const edges = docs
    .flatMap((d) => d.analysis.relations)
    .filter(
      (r) =>
        present.has(r.from.trim().toLowerCase()) &&
        present.has(r.to.trim().toLowerCase()),
    );
  return { nodes, edges };
}

export default function GraphScreen() {
  const { width } = useWindowDimensions();
  const [docs, setDocs] = useState<DocumentRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      listDocuments().then(setDocs);
    }, []),
  );

  const { nodes, edges } = useMemo(() => buildGraph(docs), [docs]);

  const size = width - spacing.lg * 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 40;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      map.set(n.name.trim().toLowerCase(), {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      });
    });
    return map;
  }, [nodes, cx, cy, r]);

  const types = useMemo(() => [...new Set(nodes.map((n) => n.type))].slice(0, 6), [nodes]);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ScreenTitle
          title="Knowledge graph"
          subtitle="People, organizations, amounts and dates connected across your documents."
        />

        {nodes.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Share2 color={colors.textFaint} size={40} />}
              title="Graph is empty"
              subtitle="Scan a few documents and the entities DocuMind extracts will appear here, linked by how they relate."
            />
          </Card>
        ) : (
          <>
            <Card style={{ padding: spacing.sm }}>
              <Svg width={size} height={size}>
                {edges.map((e, i) => {
                  const a = positions.get(e.from.trim().toLowerCase());
                  const b = positions.get(e.to.trim().toLowerCase());
                  if (!a || !b) return null;
                  return (
                    <Line
                      key={`e${i}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={colors.border}
                      strokeWidth={1.5}
                    />
                  );
                })}
                {nodes.map((n) => {
                  const p = positions.get(n.name.trim().toLowerCase())!;
                  const radius = 8 + Math.min(n.count, 6) * 2;
                  const c = colorFor(n.type);
                  return (
                    <React.Fragment key={n.name}>
                      <Circle cx={p.x} cy={p.y} r={radius} fill={c} opacity={0.9} />
                      <SvgText
                        x={p.x}
                        y={p.y + radius + 12}
                        fontSize={10}
                        fill={colors.text}
                        textAnchor="middle"
                      >
                        {n.name.length > 16 ? n.name.slice(0, 15) + "…" : n.name}
                      </SvgText>
                    </React.Fragment>
                  );
                })}
              </Svg>
            </Card>

            <Card style={{ marginTop: spacing.md }}>
              <Text style={styles.legendTitle}>Legend</Text>
              <View style={styles.legend}>
                {types.map((t) => (
                  <View key={t} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colorFor(t) }]} />
                    <Text style={styles.legendText}>{t}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.legendNote}>
                Node size reflects how often an entity appears across your library.
              </Text>
            </Card>
          </>
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg },
  legendTitle: { fontSize: font.small, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: font.small, color: colors.textMuted, textTransform: "capitalize" },
  legendNote: { fontSize: font.tiny, color: colors.textFaint, marginTop: spacing.md },
});
