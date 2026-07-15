import type { CreativeDirection, ServiceType } from "../../domain/creative-run";
import {
  directionSubheadline,
  resolveSubheadlineHighlight
} from "../../domain/subheadline-highlight";
import {
  contentTypeSortRank,
  sortIdeasByContentType,
  type IdeaRecommendation,
  type ReviewHighlightMap,
  type ReviewIdeaSection
} from "../export-pdf-kit";
import {
  creativeMixItems,
  directionServiceAt,
  type WorkflowState
} from "./model";

const contentTypeByService: Record<ServiceType, string> = {
  "single-static": "STATIC AD",
  "album-post": "ALBUM AD",
  "ugc-video": "UGC VIDEO",
  "motion-static": "SHORT VIDEO",
  resize: "RESIZE"
};

const groupDetailsByService: Record<
  ServiceType,
  { title: string; description: string; initials: string }
> = {
  "single-static": {
    title: "Static hooks",
    description: "One focused feed creative",
    initials: "Ss"
  },
  "album-post": {
    title: "Album hooks",
    description: "A swipeable multi-frame story",
    initials: "Ap"
  },
  "ugc-video": {
    title: "UGC video hooks",
    description: "A creator-led vertical video",
    initials: "Uv"
  },
  "motion-static": {
    title: "Short video hooks",
    description: "A motion-first short creative",
    initials: "Sv"
  },
  resize: {
    title: "Resize hooks",
    description: "Adapt approved work to another placement",
    initials: "R"
  }
};

export function serviceContentTypeLabel(service: ServiceType): string {
  return contentTypeByService[service];
}

export function buildAngleGroups(state: WorkflowState) {
  const entries = state.directions
    .map((direction, index) => ({
      direction,
      originalIndex: index,
      service: directionServiceAt(state, direction, index)
    }))
    .sort(
      (left, right) =>
        contentTypeSortRank(serviceContentTypeLabel(left.service)) -
          contentTypeSortRank(serviceContentTypeLabel(right.service)) ||
        left.originalIndex - right.originalIndex
    );

  return creativeMixItems(state)
    .map((mixItem) => {
      const details = groupDetailsByService[mixItem.service];
      const directions = entries.filter(
        (entry) => entry.service === mixItem.service
      );
      return {
        service: mixItem.service,
        contentType: serviceContentTypeLabel(mixItem.service),
        title: details.title,
        description: details.description,
        initials: details.initials,
        required: mixItem.quantity,
        selected: directions.filter((entry) => entry.direction.selected).length,
        directions
      };
    })
    .sort(
      (left, right) =>
        contentTypeSortRank(left.contentType) - contentTypeSortRank(right.contentType)
    );
}

function directionToExportIdea(
  direction: CreativeDirection,
  service: ServiceType,
  successMetric: WorkflowState["successMetric"]
): IdeaRecommendation {
  return {
    title: direction.hook,
    content_type: serviceContentTypeLabel(service),
    concept_idea: direction.concept,
    tags: ["Creative direction", successMetric],
    copywriting: {
      headline: direction.hook,
      sub_headline_1: directionSubheadline(direction),
      ...(direction.formatBeats?.length
        ? {
            sub_headline_2: direction.formatBeats[0],
            bullets: [...direction.formatBeats]
          }
        : {}),
      cta: direction.cta
    }
  };
}

export function buildAngleExportSections(
  state: WorkflowState
): ReviewIdeaSection[] {
  return buildAngleExportReview(state).sections;
}

export function buildAngleExportReview(state: WorkflowState): {
  sections: ReviewIdeaSection[];
  highlightMap: ReviewHighlightMap;
} {
  const exportItems = state.directions.flatMap((direction, index) => {
    if (!direction.exportGroup) return [];
    const idea = directionToExportIdea(
      direction,
      directionServiceAt(state, direction, index),
      state.successMetric
    );
    return [{
      group: direction.exportGroup,
      idea,
      highlight: resolveSubheadlineHighlight(
        directionSubheadline(direction),
        direction.subheadlineHighlight
      )
    }];
  });

  const definitions = [
    { group: "recommended", heading: "Recommended topics" },
    { group: "option", heading: "Other options" }
  ] as const;
  const sections: ReviewIdeaSection[] = [];
  const highlightMap: ReviewHighlightMap = {};

  for (const definition of definitions) {
    const items = exportItems.filter((item) => item.group === definition.group);
    const highlightsByIdea = new Map(
      items.map((item) => [item.idea, item.highlight])
    );
    const ideas = sortIdeasByContentType(items.map((item) => item.idea));
    if (ideas.length === 0) continue;

    sections.push({
      heading: definition.heading,
      group: definition.group,
      ideas
    });
    ideas.forEach((idea, index) => {
      highlightMap[`${definition.group}:${index}`] = [
        highlightsByIdea.get(idea) ?? ""
      ];
    });
  }

  return {
    sections,
    highlightMap
  };
}
