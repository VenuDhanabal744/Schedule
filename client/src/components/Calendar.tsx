import { useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Course, Meeting, Section, Selected } from '../types';
import { meetingsConflict, fmtTime } from '../schedule';
import { useRatings } from '../useRatings';
import { RatingBadge } from './RatingBadge';
import { LockIcon } from './LockIcon';

export type DragItem =
  | { type: 'chip'; code: string; sectionIdx: number }
  | { type: 'event'; code: string };

const BASE_DAYS = ['M', 'T', 'W', 'Th', 'F'];
const DAY_LABELS: Record<string, string> = {
  M: 'Monday', T: 'Tuesday', W: 'Wednesday', Th: 'Thursday', F: 'Friday',
  Sa: 'Saturday', Su: 'Sunday',
};
const PXPM = 1.1;

type Block = {
  key: string;
  code: string;
  courseTitle: string;
  section: Section;
  sectionIdx: number;
  meeting: Meeting;
  day: string;
  conflict: boolean;
  colorIdx: number;
  ghost: boolean;
  locked: boolean;
  dropId?: string; // for ghost blocks: "ghost|<code>|<sectionIdx>"
  lane: number;
  lanes: number;
};

function assignLanes(blocks: Block[]) {
  const sorted = [...blocks].sort((a, b) => a.meeting.start - b.meeting.start);
  // cluster overlapping blocks, then give each block a lane within its cluster
  let cluster: Block[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const b of cluster) {
      let lane = laneEnds.findIndex((end) => end <= b.meeting.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = b.meeting.end;
      b.lane = lane;
    }
    for (const b of cluster) b.lanes = laneEnds.length;
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.meeting.start >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.meeting.end);
  }
  if (cluster.length) flush();
}

function EventBlock({
  block,
  top,
  height,
  onToggleLock,
}: {
  block: Block;
  top: number;
  height: number;
  onToggleLock: (code: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `event-${block.code}-${block.day}-${block.meeting.start}`,
    data: { type: 'event', code: block.code } satisfies DragItem,
    disabled: block.locked,
  });
  // distinguish a genuine click from the tail end of a drag
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const instructors = block.section.instructors;
  const getRating = useRatings(instructors);
  const firstInstructor = instructors[0];
  // "Wright, Kayla" -> "Wright"; note extra co-instructors with "+1"
  const profLabel = firstInstructor
    ? firstInstructor.split(',')[0] + (instructors.length > 1 ? ` +${instructors.length - 1}` : '')
    : '';
  const width = 100 / block.lanes;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerDownCapture={(e) => {
        downPos.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        if (
          downPos.current &&
          Math.hypot(e.clientX - downPos.current.x, e.clientY - downPos.current.y) > 6
        ) {
          return; // was a drag, not a click
        }
        onToggleLock(block.code);
      }}
      className={`cal-event c${block.colorIdx}${block.conflict ? ' conflict' : ''}${
        isDragging ? ' dragging' : ''
      }${block.locked ? ' locked' : ''}${height < 40 ? ' tiny' : height < 58 ? ' compact' : ''}`}
      style={{ top, height, left: `${block.lane * width}%`, width: `calc(${width}% - 3px)` }}
      title={`${block.code} §${block.section.section} — ${block.courseTitle}\n${
        instructors.join('; ') || 'Instructor TBA'
      }\n${
        block.locked
          ? 'Locked in place — click to unlock'
          : 'Click to lock in place · drag to switch sections'
      }`}
    >
      <div className="ev-head">
        <span className="ev-code">
          {block.locked && <LockIcon />}
          {block.code.replace(/^(AS|EN)\./, '')} §{block.section.section}
        </span>
      </div>
      <div className="ev-name">{block.courseTitle}</div>
      {firstInstructor && (
        <div className="ev-prof">
          {profLabel} <RatingBadge rating={getRating(firstInstructor)} />
        </div>
      )}
      <div className="ev-time">
        {fmtTime(block.meeting.start)}–{fmtTime(block.meeting.end)}
      </div>
    </div>
  );
}

function GhostBlock({
  block,
  top,
  height,
  hovered,
}: {
  block: Block;
  top: number;
  height: number;
  hovered: boolean;
}) {
  const width = 100 / block.lanes;
  return (
    <div
      className={`cal-ghost c${block.colorIdx}${hovered ? ' over' : ''}`}
      data-drop={block.dropId ?? ''}
      style={{ top, height, left: `${block.lane * width}%`, width: `calc(${width}% - 3px)` }}
    >
      <div className="ev-code">§{block.section.section}</div>
      <div className="ev-time">
        {fmtTime(block.meeting.start)}–{fmtTime(block.meeting.end)}
      </div>
    </div>
  );
}

export function Calendar({
  courseMap,
  selected,
  colorOf,
  activeDrag,
  hoverTarget,
  onToggleLock,
}: {
  courseMap: Map<string, Course>;
  selected: Selected[];
  colorOf: (code: string) => number;
  activeDrag: DragItem | null;
  hoverTarget: string | null;
  onToggleLock: (code: string) => void;
}) {
  // real (placed) blocks
  const placed: {
    code: string;
    courseTitle: string;
    section: Section;
    sectionIdx: number;
    locked: boolean;
  }[] = [];
  for (const sel of selected) {
    const course = courseMap.get(sel.code);
    if (!course || sel.sectionIdx == null) continue;
    const section = course.sections[sel.sectionIdx];
    if (section) {
      placed.push({
        code: sel.code,
        courseTitle: course.title,
        section,
        sectionIdx: sel.sectionIdx,
        locked: !!sel.locked,
      });
    }
  }

  // ghost blocks depending on what is being dragged
  const ghosts: { code: string; section: Section; sectionIdx: number; dropId?: string }[] = [];
  if (activeDrag?.type === 'chip') {
    const course = courseMap.get(activeDrag.code);
    const section = course?.sections[activeDrag.sectionIdx];
    if (section) ghosts.push({ code: activeDrag.code, section, sectionIdx: activeDrag.sectionIdx });
  } else if (activeDrag?.type === 'event') {
    const course = courseMap.get(activeDrag.code);
    const current = selected.find((s) => s.code === activeDrag.code)?.sectionIdx;
    course?.sections.forEach((section, i) => {
      if (i !== current && section.meetings.length) {
        ghosts.push({
          code: activeDrag.code,
          section,
          sectionIdx: i,
          dropId: `ghost|${activeDrag.code}|${i}`,
        });
      }
    });
  }

  // compute day range and time bounds
  const allMeetings = [
    ...placed.flatMap((p) => p.section.meetings),
    ...ghosts.flatMap((g) => g.section.meetings),
  ];
  const days = [...BASE_DAYS];
  for (const m of allMeetings) {
    for (const d of m.days) if (!days.includes(d)) days.push(d);
  }
  let startMin = 8 * 60;
  let endMin = 22 * 60;
  for (const m of allMeetings) {
    startMin = Math.min(startMin, Math.floor(m.start / 60) * 60);
    endMin = Math.max(endMin, Math.ceil(m.end / 60) * 60);
  }
  const gridHeight = (endMin - startMin) * PXPM;
  const hours: number[] = [];
  for (let t = startMin; t < endMin; t += 60) hours.push(t);

  // conflict detection between placed blocks
  const conflictKeys = new Set<string>();
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      for (const ma of placed[i].section.meetings) {
        for (const mb of placed[j].section.meetings) {
          if (meetingsConflict(ma, mb)) {
            conflictKeys.add(placed[i].code);
            conflictKeys.add(placed[j].code);
          }
        }
      }
    }
  }

  // build per-day block lists
  const byDay = new Map<string, Block[]>(days.map((d) => [d, []]));
  const pushBlocks = (
    src: {
      code: string;
      courseTitle?: string;
      section: Section;
      sectionIdx: number;
      dropId?: string;
      locked?: boolean;
    },
    ghost: boolean
  ) => {
    src.section.meetings.forEach((meeting, mi) => {
      for (const day of meeting.days) {
        byDay.get(day)?.push({
          key: `${ghost ? 'g' : 'e'}-${src.code}-${src.sectionIdx}-${mi}-${day}`,
          code: src.code,
          courseTitle: src.courseTitle ?? '',
          locked: !!src.locked,
          section: src.section,
          sectionIdx: src.sectionIdx,
          meeting,
          day,
          conflict: !ghost && conflictKeys.has(src.code),
          colorIdx: colorOf(src.code),
          ghost,
          dropId: src.dropId,
          lane: 0,
          lanes: 1,
        });
      }
    });
  };
  placed.forEach((p) => pushBlocks(p, false));
  ghosts.forEach((g) => pushBlocks(g, true));
  for (const blocks of byDay.values()) assignLanes(blocks);

  const dropHint = activeDrag?.type === 'chip' && hoverTarget === 'calendar-drop';

  return (
    <div className={`calendar${dropHint ? ' drop-ok' : ''}`}>
      <div className="cal-scroll">
      <div className="cal-header">
        <div className="cal-gutter" />
        {days.map((d) => (
          <div key={d} className="cal-day-name">
            {DAY_LABELS[d]}
          </div>
        ))}
      </div>
      <div className="cal-body" style={{ height: gridHeight }}>
        <div className="cal-gutter">
          {hours.map((t) => (
            <div key={t} className="cal-hour-label" style={{ top: (t - startMin) * PXPM }}>
              {fmtTime(t)}
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="cal-day-col">
            {hours.map((t) => (
              <div key={t} className="cal-hour-line" style={{ top: (t - startMin) * PXPM }} />
            ))}
            {(byDay.get(d) ?? []).map((b) =>
              b.ghost ? (
                <GhostBlock
                  key={b.key}
                  block={b}
                  top={(b.meeting.start - startMin) * PXPM}
                  height={(b.meeting.end - b.meeting.start) * PXPM}
                  hovered={!!b.dropId && hoverTarget === b.dropId}
                />
              ) : (
                <EventBlock
                  key={b.key}
                  block={b}
                  top={(b.meeting.start - startMin) * PXPM}
                  height={(b.meeting.end - b.meeting.start) * PXPM}
                  onToggleLock={onToggleLock}
                />
              )
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
