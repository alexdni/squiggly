import { useState, useCallback, useEffect } from 'react';
import type { EEGAnnotation, AnnotationDragState } from './types';

const initialDragState: AnnotationDragState = {
  isDragging: false,
  startX: 0,
  endX: 0,
  startTime: 0,
  endTime: 0,
};

export function useEEGAnnotations(recordingId: string) {
  const [annotations, setAnnotations] = useState<EEGAnnotation[]>([]);
  const [dragState, setDragState] = useState<AnnotationDragState>(initialDragState);
  const [isAnnotateMode, setIsAnnotateMode] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [pendingAnnotation, setPendingAnnotation] = useState<{
    startTime: number;
    endTime: number;
  } | null>(null);

  // Load existing annotations from API on mount
  useEffect(() => {
    if (!recordingId) return;

    fetch(`/api/recordings/${recordingId}/annotations`)
      .then((res) => res.json())
      .then((data) => {
        if (data.annotations) {
          const loaded: EEGAnnotation[] = data.annotations.map((a: any) => ({
            id: crypto.randomUUID(),
            dbId: a.id,
            startTime: Number(a.start_time),
            endTime: Number(a.end_time),
            description: a.description || '',
            type: a.type as EEGAnnotation['type'],
          }));
          setAnnotations(loaded);
        }
      })
      .catch((err) => {
        console.error('Failed to load annotations:', err);
      });
  }, [recordingId]);

  const startDrag = useCallback((x: number, time: number) => {
    setDragState({
      isDragging: true,
      startX: x,
      endX: x,
      startTime: time,
      endTime: time,
    });
  }, []);

  const updateDrag = useCallback((x: number, time: number) => {
    setDragState((prev) => ({
      ...prev,
      endX: x,
      endTime: time,
    }));
  }, []);

  const endDrag = useCallback((x: number, time: number) => {
    setDragState((prev) => {
      const pixelDist = Math.abs(x - prev.startX);
      // Minimum 5px drag to trigger annotation
      if (pixelDist < 5) {
        return initialDragState;
      }

      const startTime = Math.min(prev.startTime, time);
      const endTime = Math.max(prev.startTime, time);

      setPendingAnnotation({ startTime, endTime });
      setShowModal(true);

      return initialDragState;
    });
  }, []);

  const cancelDrag = useCallback(() => {
    setDragState(initialDragState);
  }, []);

  const addAnnotation = useCallback(
    (description: string, type: EEGAnnotation['type']) => {
      if (!pendingAnnotation) return;

      const localId = crypto.randomUUID();
      const annotation: EEGAnnotation = {
        id: localId,
        startTime: pendingAnnotation.startTime,
        endTime: pendingAnnotation.endTime,
        description,
        type,
      };

      setAnnotations((prev) => [...prev, annotation]);
      setPendingAnnotation(null);
      setShowModal(false);

      // Persist to API
      fetch(`/api/recordings/${recordingId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: annotation.startTime,
          endTime: annotation.endTime,
          type: annotation.type,
          description: annotation.description,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.annotation?.id) {
            setAnnotations((prev) =>
              prev.map((a) =>
                a.id === localId ? { ...a, dbId: data.annotation.id } : a
              )
            );
          }
        })
        .catch((err) => {
          console.error('Failed to persist annotation:', err);
        });
    },
    [pendingAnnotation, recordingId]
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      const annotation = annotations.find((a) => a.id === id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));

      // Delete from API if it has a dbId
      if (annotation?.dbId) {
        fetch(
          `/api/recordings/${recordingId}/annotations?annotationId=${annotation.dbId}`,
          { method: 'DELETE' }
        ).catch((err) => {
          console.error('Failed to delete annotation from API:', err);
        });
      }
    },
    [annotations, recordingId]
  );

  const cancelAnnotation = useCallback(() => {
    setPendingAnnotation(null);
    setShowModal(false);
  }, []);

  return {
    annotations,
    dragState,
    isAnnotateMode,
    setIsAnnotateMode,
    showModal,
    pendingAnnotation,
    startDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    addAnnotation,
    removeAnnotation,
    cancelAnnotation,
  };
}
