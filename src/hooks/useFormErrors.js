// Shared missing-field handling for forms (owner UX audit, 2026-11-21): show(field, message) puts the explanation
// inline under that field (render <FieldError message={form.errorFor(field)} />), scrolls it into view and focuses its
// input when one is registered. Wire-up: ScrollView ref={form.scrollRef}, one View ref={form.contentRef} around the
// scroll content, the field's wrapper ref={form.anchor('name')} and its TextInput ref={form.input('name')}; call
// form.clear('name') when the person edits it. Values are never touched.
import { useCallback, useEffect, useRef, useState } from 'react';
import { firstFormProblem, formErrorScrollY } from '../utils/formErrors';

export default function useFormErrors() {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const anchors = useRef({});
  const inputs = useRef({});
  const refCallbacks = useRef({});
  const [errors, setErrors] = useState({});
  const [reveal, setReveal] = useState(null);

  const show = useCallback((field, message) => {
    setErrors({ [field]: message });
    setReveal((r) => ({ field, n: (r?.n ?? 0) + 1 }));
  }, []);
  // problems: [{ field, message }], order: fields top to bottom. Shows the first; returns whether anything was shown.
  const showFirst = useCallback((problems, order) => {
    const p = firstFormProblem(problems, order);
    if (p) show(p.field, p.message);
    return !!p;
  }, [show]);
  const clear = useCallback((field) => {
    setErrors((e) => {
      if (!e[field]) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  }, []);
  const stable = (kind, store, field) => {
    const key = `${kind}:${field}`;
    if (!refCallbacks.current[key]) {
      refCallbacks.current[key] = (node) => {
        if (node) store.current[field] = node;
        else delete store.current[field];
      };
    }
    return refCallbacks.current[key];
  };
  const anchor = (field) => stable('anchor', anchors, field);
  const input = (field) => stable('input', inputs, field);

  useEffect(() => {
    if (!reveal) return undefined;
    const frame = requestAnimationFrame(() => {
      const node = anchors.current[reveal.field];
      const content = contentRef.current;
      const focus = () => inputs.current[reveal.field]?.focus?.();
      if (!node || !content || !scrollRef.current) { focus(); return; }
      try {
        node.measureLayout(
          content,
          (_x, y) => {
            const target = formErrorScrollY(y);
            if (target != null) scrollRef.current?.scrollTo({ y: target, animated: true });
            focus();
          },
          focus,
        );
      } catch (_e) {
        focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);

  return { scrollRef, contentRef, anchor, input, show, showFirst, clear, errorFor: (field) => errors[field] ?? null };
}
