const SUPPORTED_COMPONENTS = new Set([
  "Button",
  "Card",
  "CheckBox",
  "ChoicePicker",
  "Column",
  "Divider",
  "EducationCard",
  "Row",
  "Text",
  "TextField"
]);

const SUPPORTED_EDUCATION_CARD_TYPES = new Set([
  "compiler.status",
  "exam.progress",
  "exam.result",
  "knowledge.explanation",
  "knowledge.mindmap",
  "language.grammar",
  "language.vocabulary",
  "media.image",
  "media.video",
  "oral.practice",
  "quiz.single-choice"
]);

export class A2UIRenderer {
  constructor(root, { onEvent, onError } = {}) {
    this.root = root;
    this.onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this.onError = typeof onError === "function" ? onError : () => {};
    this.surfaces = new Map();
    this.activeSurfaceId = "";
  }

  applyMessages(messages) {
    if (!Array.isArray(messages)) {
      this.reportError("INVALID_MESSAGES", "A2UI messages must be an array");
      return false;
    }

    for (const message of messages) this.applyMessage(message);
    return this.renderActiveSurface();
  }

  clear() {
    this.surfaces.clear();
    this.activeSurfaceId = "";
    this.root.replaceChildren();
  }

  getActiveDataModel() {
    return structuredClone(this.surfaces.get(this.activeSurfaceId)?.dataModel || {});
  }

  patchEducationCard(cardId, { state = {}, props = {}, meta = {} } = {}) {
    const normalizedCardId = safeId(cardId);
    const surface = this.surfaces.get(this.activeSurfaceId);
    if (!normalizedCardId || !surface) return false;

    let updated = false;
    for (const [componentId, definition] of surface.components.entries()) {
      if (
        definition?.component !== "EducationCard" ||
        safeId(definition.card?.id) !== normalizedCardId
      ) {
        continue;
      }
      const nextDefinition = structuredClone(definition);
      nextDefinition.card = {
        ...nextDefinition.card,
        state: {
          ...objectRecord(nextDefinition.card?.state),
          ...objectRecord(state)
        },
        props: {
          ...objectRecord(nextDefinition.card?.props),
          ...objectRecord(props)
        },
        meta: {
          ...objectRecord(nextDefinition.card?.meta),
          ...objectRecord(meta)
        }
      };
      surface.components.set(componentId, nextDefinition);
      updated = true;
    }

    return updated ? this.renderActiveSurface() : false;
  }

  applyMessage(message) {
    if (message?.version !== "v0.9") {
      this.reportError("UNSUPPORTED_VERSION", `Unsupported A2UI version: ${message?.version || "missing"}`);
      return;
    }

    if (message.createSurface) {
      const surfaceId = safeId(message.createSurface.surfaceId);
      if (!surfaceId) {
        this.reportError("INVALID_SURFACE", "createSurface requires a valid surfaceId");
        return;
      }
      this.surfaces.set(surfaceId, {
        catalogId: String(message.createSurface.catalogId || ""),
        sendDataModel: Boolean(message.createSurface.sendDataModel),
        components: new Map(),
        dataModel: {}
      });
      this.activeSurfaceId = surfaceId;
      return;
    }

    if (message.updateComponents) {
      const surface = this.surfaces.get(safeId(message.updateComponents.surfaceId));
      if (!surface) {
        this.reportError("SURFACE_NOT_FOUND", "updateComponents referenced an unknown surface");
        return;
      }
      for (const component of message.updateComponents.components || []) {
        const id = safeId(component?.id);
        if (!id || !SUPPORTED_COMPONENTS.has(component?.component)) {
          this.reportError("VALIDATION_FAILED", `Unsupported component: ${component?.component || "unknown"}`);
          continue;
        }
        surface.components.set(id, structuredClone(component));
      }
      return;
    }

    if (message.updateDataModel) {
      const surface = this.surfaces.get(safeId(message.updateDataModel.surfaceId));
      if (!surface) {
        this.reportError("SURFACE_NOT_FOUND", "updateDataModel referenced an unknown surface");
        return;
      }
      const path = message.updateDataModel.path || "/";
      if (path === "/") {
        surface.dataModel = structuredClone(message.updateDataModel.value || {});
      } else {
        setPointer(surface.dataModel, path, structuredClone(message.updateDataModel.value));
      }
      return;
    }

    if (message.deleteSurface) {
      const surfaceId = safeId(message.deleteSurface.surfaceId);
      this.surfaces.delete(surfaceId);
      if (this.activeSurfaceId === surfaceId) this.activeSurfaceId = "";
    }
  }

  renderActiveSurface() {
    const surface = this.surfaces.get(this.activeSurfaceId);
    this.root.replaceChildren();
    if (!surface) return false;
    if (!surface.components.has("root")) {
      this.reportError("VALIDATION_FAILED", "A2UI surface is missing the root component");
      return false;
    }

    const element = this.renderComponent(surface, "root", new Set(), 0);
    if (!element) return false;
    this.root.dataset.surfaceId = this.activeSurfaceId;
    this.root.append(element);
    queueMicrotask(() => {
      globalThis.lucide?.createIcons?.({
        attrs: {
          "stroke-width": 1.8
        }
      });
    });
    return true;
  }

  renderComponent(surface, componentId, stack, depth) {
    if (depth > 24 || stack.has(componentId)) {
      this.reportError("VALIDATION_FAILED", `Circular or too-deep component tree at ${componentId}`);
      return null;
    }

    const definition = surface.components.get(componentId);
    if (!definition) {
      this.reportError("VALIDATION_FAILED", `Missing component reference: ${componentId}`);
      return null;
    }

    stack.add(componentId);
    let element;
    switch (definition.component) {
      case "Column":
        element = this.renderContainer(surface, definition, stack, depth, "a2ui-column");
        break;
      case "Row":
        element = this.renderContainer(surface, definition, stack, depth, "a2ui-row");
        break;
      case "Card":
        element = document.createElement("section");
        element.className = "a2ui-card";
        appendChild(element, this.renderComponent(surface, definition.child, stack, depth + 1));
        break;
      case "Text":
        element = document.createElement("span");
        element.className = `a2ui-text a2ui-text-${safeVariant(definition.variant)}`;
        element.textContent = String(resolveBoundValue(definition.text, surface.dataModel) ?? "");
        break;
      case "Divider":
        element = document.createElement("hr");
        element.className = "a2ui-divider";
        break;
      case "EducationCard":
        element = this.renderEducationCard(surface, definition);
        break;
      case "TextField":
        element = this.renderTextField(surface, definition);
        break;
      case "ChoicePicker":
        element = this.renderChoicePicker(surface, definition);
        break;
      case "CheckBox":
        element = this.renderCheckBox(surface, definition);
        break;
      case "Button":
        element = this.renderButton(surface, definition, stack, depth);
        break;
      default:
        this.reportError("VALIDATION_FAILED", `Unsupported component: ${definition.component}`);
        element = null;
    }
    stack.delete(componentId);

    if (element) {
      element.dataset.a2uiComponentId = definition.id;
      element.dataset.a2uiComponent = definition.component;
    }
    return element;
  }

  renderContainer(surface, definition, stack, depth, className) {
    const element = document.createElement("div");
    element.className = className;
    for (const childId of Array.isArray(definition.children) ? definition.children : []) {
      appendChild(element, this.renderComponent(surface, childId, stack, depth + 1));
    }
    return element;
  }

  renderEducationCard(surface, definition) {
    const normalized = normalizeEducationCard(definition.card);
    if (!normalized.ok) {
      this.reportError("VALIDATION_FAILED", normalized.message);
      return educationCardFallback(normalized.message);
    }

    const card = normalized.card;
    const state = card.state;
    const element = document.createElement("section");
    const status =
      normalizeEducationStatus(state.status || state.result) ||
      (typeof state.correct === "boolean" ? (state.correct ? "correct" : "incorrect") : "");
    element.className = `edu-card edu-card--${educationTypeClass(card.type)}`;
    element.dataset.eduCardId = card.id;
    element.dataset.eduCardType = card.type;
    element.dataset.eduCardVersion = card.version;
    if (status) element.classList.add(`is-${status}`);
    if (state.disabled || state.locked) element.classList.add("is-disabled");
    if (state.loading || status === "loading") {
      element.classList.add("is-loading");
      element.setAttribute("aria-busy", "true");
    }
    if (state.disabled || state.locked) element.setAttribute("aria-disabled", "true");

    appendChild(element, this.renderEducationHeader(card));

    let content;
    switch (card.type) {
      case "knowledge.explanation":
        content = this.renderKnowledgeExplanation(card);
        break;
      case "quiz.single-choice":
        content = this.renderSingleChoiceCard(surface, definition, card);
        break;
      case "knowledge.mindmap":
        content = this.renderKnowledgeMindmap(card);
        break;
      case "language.vocabulary":
        content = this.renderLanguageVocabulary(card);
        break;
      case "language.grammar":
        content = this.renderLanguageGrammar(card);
        break;
      case "media.image":
        content = this.renderEducationImage(card);
        break;
      case "media.video":
        content = this.renderEducationVideo(card);
        break;
      case "oral.practice":
        content = this.renderOralPractice(card);
        break;
      case "exam.progress":
        content = this.renderExamProgress(card);
        break;
      case "exam.result":
        content = this.renderExamResult(card);
        break;
      case "compiler.status":
        content = this.renderCompilerStatus(card);
        break;
      default:
        content = educationCardFallback("暂不支持此学习卡片");
    }
    appendChild(element, content);

    const primaryAction = this.renderEducationPrimaryAction(surface, definition, card);
    appendChild(element, primaryAction);
    return element;
  }

  renderEducationHeader(card) {
    const { meta, props } = card;
    const title = firstText(props.title, meta.title, defaultEducationTitle(card.type));
    const eyebrow = firstText(meta.eyebrow, meta.subject, meta.category);
    const badge = firstText(meta.badge, meta.difficulty, meta.status_label);
    const subtitle = firstText(props.subtitle, meta.subtitle);
    const tags = valueList(meta.tags).slice(0, 4);

    const header = document.createElement("header");
    header.className = "edu-card__header";
    if (eyebrow) {
      const kicker = document.createElement("span");
      kicker.className = "edu-card__eyebrow";
      kicker.textContent = eyebrow;
      header.append(kicker);
    }

    const titleRow = document.createElement("div");
    titleRow.className = "edu-card__title-row";
    const heading = document.createElement("h3");
    heading.className = "edu-card__title";
    heading.textContent = title;
    titleRow.append(heading);
    if (badge) {
      const badgeElement = document.createElement("span");
      badgeElement.className = "edu-card__badge";
      badgeElement.textContent = badge;
      titleRow.append(badgeElement);
    }
    header.append(titleRow);

    if (subtitle) {
      const copy = document.createElement("p");
      copy.className = "edu-card__subtitle";
      copy.textContent = subtitle;
      header.append(copy);
    }

    if (tags.length) {
      const tagList = document.createElement("div");
      tagList.className = "edu-card__tags";
      tags.forEach((tag) => {
        const item = document.createElement("span");
        item.className = "edu-card__tag";
        item.textContent = textFromValue(tag);
        tagList.append(item);
      });
      header.append(tagList);
    }
    return header;
  }

  renderKnowledgeExplanation(card) {
    const { props } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-explanation";
    appendEducationCopy(
      body,
      firstText(props.content, props.body, props.summary, props.text),
      "edu-explanation__copy"
    );

    const formula = firstText(props.formula, props.equation);
    if (formula) {
      const formulaElement = document.createElement("div");
      formulaElement.className = "edu-explanation__formula";
      formulaElement.textContent = formula;
      formulaElement.setAttribute("aria-label", `公式：${formula}`);
      body.append(formulaElement);
    }

    const points = valueList(props.points || props.key_points || props.bullets).slice(0, 8);
    if (points.length) {
      const list = document.createElement("ul");
      list.className = "edu-explanation__points";
      points.forEach((point) => {
        const item = document.createElement("li");
        item.textContent = textFromValue(point);
        list.append(item);
      });
      body.append(list);
    }

    const sections = valueList(props.sections).slice(0, 6);
    sections.forEach((section) => {
      const record = objectRecord(section);
      const block = document.createElement("section");
      block.className = "edu-explanation__section";
      const headingText = firstText(record.title, record.heading);
      if (headingText) {
        const heading = document.createElement("h4");
        heading.textContent = headingText;
        block.append(heading);
      }
      appendEducationCopy(block, firstText(record.content, record.body, record.text));
      body.append(block);
    });

    const callout = firstText(props.callout, props.tip, props.highlight);
    if (callout) {
      const note = document.createElement("aside");
      note.className = "edu-callout";
      note.textContent = callout;
      body.append(note);
    }
    appendChild(body, educationSourceLine(props.sources || props.citations || card.meta.sources));
    return body;
  }

  renderLanguageVocabulary(card) {
    const { props } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-vocabulary";
    const entries = valueList(props.entries).slice(0, 5);
    const list = document.createElement("div");
    list.className = "edu-vocabulary__entries";

    entries.forEach((entry) => {
      const record = objectRecord(entry);
      const item = document.createElement("article");
      item.className = "edu-vocabulary__entry";

      const wordRow = document.createElement("div");
      wordRow.className = "edu-vocabulary__word-row";
      const word = document.createElement("strong");
      word.className = "edu-vocabulary__word";
      word.textContent = firstText(record.word, record.headword, "Word");
      wordRow.append(word);

      const phonetic = firstText(record.phonetic, record.pronunciation);
      if (phonetic) {
        const pronunciation = document.createElement("span");
        pronunciation.className = "edu-vocabulary__phonetic";
        pronunciation.textContent = phonetic;
        wordRow.append(pronunciation);
      }

      const partOfSpeech = firstText(
        record.part_of_speech,
        record.partOfSpeech,
        record.pos
      );
      if (partOfSpeech) {
        const pos = document.createElement("span");
        pos.className = "edu-vocabulary__pos";
        pos.textContent = partOfSpeech;
        wordRow.append(pos);
      }
      item.append(wordRow);

      const meaning = document.createElement("p");
      meaning.className = "edu-vocabulary__meaning";
      meaning.textContent = firstText(record.meaning, record.definition);
      item.append(meaning);

      const example = firstText(record.example, record.sentence);
      if (example) {
        const sentence = document.createElement("p");
        sentence.className = "edu-vocabulary__example";
        sentence.textContent = example;
        item.append(sentence);
      }

      const translation = firstText(record.translation, record.example_translation);
      if (translation) {
        const translated = document.createElement("p");
        translated.className = "edu-vocabulary__translation";
        translated.textContent = translation;
        item.append(translated);
      }
      list.append(item);
    });

    appendChild(body, entries.length ? list : educationEmptyState("暂无单词"));
    appendChild(body, educationSourceLine(props.sources || card.meta.sources));
    return body;
  }

  renderLanguageGrammar(card) {
    const { props } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-grammar";

    const pattern = firstText(props.pattern, props.formula);
    if (pattern) {
      const patternElement = document.createElement("div");
      patternElement.className = "edu-grammar__pattern";
      patternElement.textContent = pattern;
      body.append(patternElement);
    }

    appendEducationCopy(
      body,
      firstText(props.explanation, props.body),
      "edu-grammar__explanation"
    );

    const examples = valueList(props.examples).slice(0, 4);
    if (examples.length) {
      const exampleList = document.createElement("div");
      exampleList.className = "edu-grammar__examples";
      examples.forEach((example) => {
        const record = objectRecord(example);
        const item = document.createElement("article");
        item.className = "edu-grammar__example";
        const sentence = document.createElement("strong");
        sentence.textContent = firstText(record.sentence, record.text);
        item.append(sentence);
        const translation = firstText(record.translation, record.meaning);
        if (translation) {
          const translated = document.createElement("span");
          translated.textContent = translation;
          item.append(translated);
        }
        exampleList.append(item);
      });
      body.append(exampleList);
    }

    const breakdown = valueList(props.breakdown).slice(0, 6);
    if (breakdown.length) {
      const breakdownList = document.createElement("div");
      breakdownList.className = "edu-grammar__breakdown";
      breakdown.forEach((part) => {
        const record = objectRecord(part);
        const segment = document.createElement("div");
        segment.className = "edu-grammar__segment";
        const token = document.createElement("strong");
        token.textContent = firstText(record.segment, record.text);
        const role = document.createElement("span");
        role.textContent = firstText(record.role, record.label);
        segment.append(token, role);
        breakdownList.append(segment);
      });
      body.append(breakdownList);
    }

    const tip = firstText(props.tip, props.callout);
    if (tip) {
      const note = document.createElement("aside");
      note.className = "edu-callout edu-grammar__tip";
      note.textContent = tip;
      body.append(note);
    }
    appendChild(body, educationSourceLine(props.sources || card.meta.sources));
    return body;
  }

  renderSingleChoiceCard(surface, definition, card) {
    const { props, state } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-quiz";
    const question = firstText(props.question, props.prompt, props.body, props.title, "请选择一个答案");
    const questionId = firstText(
      props.question_id,
      props.questionId,
      card.meta.question_id,
      card.meta.questionId,
      card.id
    );
    const fieldset = document.createElement("fieldset");
    fieldset.className = "edu-quiz__fieldset";
    const legend = document.createElement("legend");
    legend.className = "edu-quiz__question";
    legend.textContent = question;
    fieldset.append(legend);

    const optionsRoot = document.createElement("div");
    optionsRoot.className = "edu-quiz__options";
    const options = normalizeQuizOptions(props.options || props.choices).slice(0, 12);
    optionsRoot.dataset.optionCount = String(options.length);
    const selectedValue = firstDefined(
      state.selected,
      state.selected_value,
      state.selectedValue,
      props.selected
    );
    const result =
      normalizeEducationResult(state.result || state.status) ||
      (typeof state.correct === "boolean" ? (state.correct ? "correct" : "incorrect") : "");
    const correctValue = firstDefined(
      state.correct_answer,
      state.correctAnswer,
      state.correct_value,
      state.correctValue
    );
    const revealResult = Boolean(
      result ||
        state.reveal_answer ||
        state.revealAnswer ||
        state.show_result ||
        state.showResult
    );
    const disabled = Boolean(state.disabled || state.locked || state.loading);
    const optionRecords = [];
    let currentSelection = selectedValue;

    const syncOptionState = () => {
      optionRecords.forEach(({ input, label, option }) => {
        const selected = sameChoiceValue(option.value, currentSelection);
        input.checked = selected;
        label.classList.toggle("is-selected", selected);
        label.classList.remove("is-correct", "is-incorrect");
        if (!revealResult) return;
        const feedback = deriveQuizOptionFeedback({
          optionValue: option.value,
          selectedValue: currentSelection,
          correctValue,
          result,
          revealResult
        });
        if (feedback) label.classList.add(`is-${feedback}`);
      });
    };

    options.forEach((option, index) => {
      const inputId = safeId(`${this.activeSurfaceId}_${card.id}_${definition.id}_${index}`) || `edu_option_${index}`;
      const optionLabel = document.createElement("label");
      optionLabel.className = "edu-quiz-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.id = inputId;
      input.name = `${safeId(this.activeSurfaceId)}_${safeId(card.id)}_${safeId(questionId)}`;
      input.value = String(option.value ?? "");
      input.disabled = disabled || Boolean(option.disabled);
      const marker = document.createElement("span");
      marker.className = "edu-quiz-option__marker";
      marker.textContent = quizOptionMarker(index);
      marker.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "edu-quiz-option__copy";
      const label = document.createElement("b");
      label.textContent = option.label;
      copy.append(label);
      if (option.description) {
        const description = document.createElement("small");
        description.textContent = option.description;
        copy.append(description);
      }
      optionLabel.append(input, marker, copy);
      optionRecords.push({ input, label: optionLabel, option });
      input.addEventListener("change", () => {
        if (!input.checked || input.disabled) return;
        currentSelection = option.value;
        state.selected = option.value;
        syncOptionState();
        status.textContent = `已选择：${option.label}`;
        const selectAction = normalizeEducationAction(
          option.action ||
            findEducationAction(card.actions, "answer.select", option.value) ||
            card.actions.select ||
            card.actions.option,
          "answer.select",
          option.label
        );
        this.emitEducationAction(surface, definition, card, selectAction, {
          question_id: questionId,
          value: option.value,
          label: option.label,
          ...objectRecord(option.context)
        }, `${definition.id}_option_${index + 1}`);
      });
      optionsRoot.append(optionLabel);
    });
    syncOptionState();
    fieldset.append(optionsRoot);
    body.append(fieldset);

    const status = document.createElement("p");
    status.className = "edu-quiz__status";
    status.setAttribute("aria-live", "polite");
    status.textContent = quizStatusText(state, currentSelection, options);
    body.append(status);

    const hint = firstText(props.hint, props.tip);
    if (hint && (state.show_hint || state.showHint || !props.hide_hint)) {
      const hintElement = document.createElement("p");
      hintElement.className = "edu-quiz__hint";
      hintElement.textContent = `提示：${hint}`;
      body.append(hintElement);
    }

    const explanation = firstText(props.explanation, props.answer_explanation);
    if (
      explanation &&
      (revealResult || state.show_explanation || state.showExplanation)
    ) {
      const explanationElement = document.createElement("div");
      explanationElement.className = "edu-quiz__explanation";
      explanationElement.textContent = explanation;
      body.append(explanationElement);
    }
    return body;
  }

  renderKnowledgeMindmap(card) {
    const body = document.createElement("div");
    body.className = "edu-card__body edu-mindmap";
    const tree = normalizeMindmap(card.props);
    if (!tree) {
      body.append(educationEmptyState("暂无知识结构"));
      return body;
    }

    const treeRoot = document.createElement("div");
    treeRoot.className = "edu-mindmap__tree";
    treeRoot.setAttribute("role", "tree");
    treeRoot.append(renderMindmapNode(tree, 0, new Set(), 0));
    body.append(treeRoot);
    appendChild(body, educationSourceLine(card.props.sources || card.meta.sources));
    return body;
  }

  renderEducationImage(card) {
    const { props } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-media edu-media--image";
    const source = safeMediaUrl(props.src || props.url);
    if (!source) {
      body.append(educationEmptyState("图片地址不可用"));
      return body;
    }

    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.className = "edu-media__asset";
    image.src = source;
    image.alt = props.decorative
      ? ""
      : firstText(props.alt, props.title, card.meta.title, "学习图片");
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    figure.append(image);
    const caption = firstText(props.caption, props.description, props.credit);
    if (caption) {
      const captionElement = document.createElement("figcaption");
      captionElement.textContent = caption;
      figure.append(captionElement);
    }
    body.append(figure);
    return body;
  }

  renderEducationVideo(card) {
    const { props } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-media edu-media--video";
    const source = safeMediaUrl(props.src || props.url);
    if (!source) {
      body.append(educationEmptyState("视频地址不可用"));
      return body;
    }

    const figure = document.createElement("figure");
    const poster = safeMediaUrl(props.poster);
    if (String(props.availability || "").toLowerCase() === "mock") {
      const mock = document.createElement("div");
      mock.className = "edu-video-mock";
      if (poster) {
        const image = document.createElement("img");
        image.className = "edu-media__asset";
        image.src = poster;
        image.alt = firstText(props.title, card.meta.title, "视频预览图");
        mock.append(image);
      }
      const play = document.createElement("span");
      play.className = "edu-video-mock__play";
      play.setAttribute("aria-hidden", "true");
      play.append(lucideIcon("play"));
      const badge = document.createElement("span");
      badge.className = "edu-video-mock__badge";
      badge.textContent = "Mock 视频素材位";
      mock.append(play, badge);
      figure.append(mock);
    } else {
      const video = document.createElement("video");
      video.className = "edu-media__asset";
      video.src = source;
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      if (poster) video.poster = poster;
      const trackSource = safeMediaUrl(props.caption_src || props.captionSrc);
      if (trackSource) {
        const track = document.createElement("track");
        track.kind = "captions";
        track.src = trackSource;
        track.srclang = firstText(props.caption_language, props.captionLanguage, "zh");
        track.label = firstText(props.caption_label, props.captionLabel, "字幕");
        video.append(track);
      }
      figure.append(video);
    }
    const caption = firstText(props.caption, props.description);
    if (caption) {
      const captionElement = document.createElement("figcaption");
      captionElement.textContent = caption;
      figure.append(captionElement);
    }
    body.append(figure);
    return body;
  }

  renderOralPractice(card) {
    const { props, state } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-oral";
    const prompt = firstText(props.prompt, props.question, props.body, "请朗读下面的内容");
    const promptElement = document.createElement("blockquote");
    promptElement.className = "edu-oral__prompt";
    promptElement.textContent = prompt;
    body.append(promptElement);

    const reference = firstText(
      props.reference_text,
      props.referenceText,
      props.reference_answer,
      props.reference,
      props.sample_answer
    );
    if (reference) {
      const referenceBlock = document.createElement("div");
      referenceBlock.className = "edu-oral__reference";
      const label = document.createElement("span");
      label.textContent = "参考表达";
      const copy = document.createElement("p");
      copy.textContent = reference;
      referenceBlock.append(label, copy);
      body.append(referenceBlock);
    }

    const timeLimit = finiteNumber(
      firstDefined(props.time_limit_seconds, props.timeLimitSeconds, props.duration_seconds)
    );
    const dimensions = valueList(
      props.scoring_dimensions || props.scoringDimensions
    )
      .map(textFromValue)
      .filter(Boolean)
      .slice(0, 5);
    if (timeLimit !== null || dimensions.length) {
      const meta = document.createElement("div");
      meta.className = "edu-oral__meta";
      if (timeLimit !== null) {
        const time = document.createElement("span");
        time.textContent = `建议时长 ${formatDuration(timeLimit)}`;
        meta.append(time);
      }
      dimensions.forEach((dimension) => {
        const item = document.createElement("span");
        item.textContent = dimension;
        meta.append(item);
      });
      body.append(meta);
    }

    const tips = valueList(props.tips || props.key_points).slice(0, 6);
    if (tips.length) {
      const tipList = document.createElement("ul");
      tipList.className = "edu-oral__tips";
      tips.forEach((tip) => {
        const item = document.createElement("li");
        item.textContent = textFromValue(tip);
        tipList.append(item);
      });
      body.append(tipList);
    }

    const score = finiteNumber(firstDefined(state.score, props.score));
    const feedback = firstText(state.feedback, props.feedback);
    if (score !== null || feedback) {
      const result = document.createElement("div");
      result.className = "edu-oral__result";
      if (score !== null) {
        const scoreElement = document.createElement("strong");
        scoreElement.textContent = `${formatNumber(score)} 分`;
        result.append(scoreElement);
      }
      if (feedback) {
        const copy = document.createElement("p");
        copy.textContent = feedback;
        result.append(copy);
      }
      body.append(result);
    }
    return body;
  }

  renderExamProgress(card) {
    const { props, state } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-exam-progress";
    const current = nonNegativeNumber(firstDefined(state.current, props.current), 0);
    const total = Math.max(1, nonNegativeNumber(firstDefined(state.total, props.total), 1));
    const answered = nonNegativeNumber(firstDefined(state.answered, props.answered), current);
    const progress = clampPercent(
      firstDefined(state.progress, props.progress, (answered / total) * 100)
    );
    body.append(progressBlock(progress, `${Math.min(answered, total)} / ${total} 已作答`));

    const metrics = [
      ["当前题目", `${Math.min(current || answered + 1, total)} / ${total}`],
      ["已作答", `${Math.min(answered, total)} 题`],
      ["答对", optionalNumberText(firstDefined(state.correct, props.correct), "题")],
      [
        "剩余时间",
        formatDuration(firstDefined(state.remaining_seconds, state.remainingSeconds, props.remaining_seconds))
      ]
    ].filter((item) => item[1]);
    body.append(educationMetrics(metrics));
    appendEducationCopy(body, firstText(props.message, props.summary), "edu-exam-progress__message");
    return body;
  }

  renderExamResult(card) {
    const { props, state } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-exam-result";
    const score = finiteNumber(firstDefined(state.score, props.score));
    const totalScore = finiteNumber(
      firstDefined(state.total_score, state.totalScore, props.total_score, props.totalScore)
    );
    const total = finiteNumber(firstDefined(state.total, props.total));
    const correct = finiteNumber(firstDefined(state.correct, props.correct));
    const percent = clampPercent(
      firstDefined(
        state.percent,
        props.percent,
        score !== null && totalScore ? (score / totalScore) * 100 : undefined,
        correct !== null && total ? (correct / total) * 100 : 0
      )
    );

    const scoreHero = document.createElement("div");
    scoreHero.className = "edu-exam-result__score";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent =
      score === null
        ? `${formatNumber(percent)}%`
        : `${formatNumber(score)}${totalScore ? ` / ${formatNumber(totalScore)}` : " 分"}`;
    const scoreLabel = document.createElement("span");
    scoreLabel.textContent = firstText(props.grade, state.grade, "本次成绩");
    scoreHero.append(scoreValue, scoreLabel);
    body.append(scoreHero, progressBlock(percent, `正确率 ${formatNumber(percent)}%`));

    const metrics = [
      ["答对", optionalNumberText(correct, "题")],
      ["总题数", optionalNumberText(total, "题")],
      ["答错", optionalNumberText(firstDefined(state.incorrect, props.incorrect), "题")],
      [
        "用时",
        formatDuration(firstDefined(state.duration_seconds, state.durationSeconds, props.duration_seconds))
      ]
    ].filter((item) => item[1]);
    if (metrics.length) body.append(educationMetrics(metrics));
    appendEducationCopy(body, firstText(props.summary, props.feedback, state.feedback), "edu-exam-result__summary");
    return body;
  }

  renderCompilerStatus(card) {
    const { props, state } = card;
    const body = document.createElement("div");
    body.className = "edu-card__body edu-compiler";
    const rawStatus = firstText(state.status, props.status, "pending").toLowerCase();
    const status = compilerStatus(rawStatus);
    const progress = clampPercent(firstDefined(state.progress, props.progress, status.progress));

    const statusRow = document.createElement("div");
    statusRow.className = `edu-compiler__status is-${status.key}`;
    const label = document.createElement("strong");
    label.textContent = firstText(props.status_label, props.statusLabel, status.label);
    const progressText = document.createElement("span");
    progressText.textContent = `${formatNumber(progress)}%`;
    statusRow.append(label, progressText);
    body.append(statusRow, progressBlock(progress, firstText(props.message, state.message, status.message)));

    const unitCount = finiteNumber(
      firstDefined(props.knowledge_unit_count, props.knowledgeUnitCount)
    );
    const suggestedCards = valueList(
      props.suggested_cards || props.suggestedCards
    )
      .map(textFromValue)
      .filter(Boolean);
    const compilerMetrics = [
      unitCount === null ? null : ["知识单元", `${formatNumber(unitCount)} 个`],
      suggestedCards.length ? ["可生成卡片", `${suggestedCards.length} 类`] : null
    ].filter(Boolean);
    if (compilerMetrics.length) body.append(educationMetrics(compilerMetrics));

    const steps = valueList(props.steps || state.steps).slice(0, 8);
    if (steps.length) {
      const list = document.createElement("ol");
      list.className = "edu-compiler__steps";
      steps.forEach((step) => {
        const record = objectRecord(step);
        const item = document.createElement("li");
        const stepStatus = compilerStatus(firstText(record.status, "pending").toLowerCase());
        item.className = `is-${stepStatus.key}`;
        const title = document.createElement("span");
        title.textContent = firstText(record.label, record.title, record.name, textFromValue(step));
        const stateLabel = document.createElement("small");
        stateLabel.textContent = stepStatus.label;
        item.append(title, stateLabel);
        list.append(item);
      });
      body.append(list);
    }
    appendChild(body, educationSourceLine(props.sources || card.meta.sources));
    return body;
  }

  renderEducationPrimaryAction(surface, definition, card) {
    const rawAction = card.actions.primary || findEducationAction(card.actions, "", undefined, true);
    if (!rawAction) return null;
    const action = normalizeEducationAction(rawAction, "", "继续");
    if (!action.name) {
      this.reportError("VALIDATION_FAILED", `EducationCard ${card.id} primary action requires a name`);
      return null;
    }

    const footer = document.createElement("footer");
    footer.className = "edu-card__footer";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "edu-card__primary";
    button.textContent = action.label || "继续";
    button.disabled = Boolean(
      card.state.disabled ||
        card.state.locked ||
        card.state.loading ||
        action.disabled
    );
    if (card.state.loading || action.loading) {
      button.classList.add("is-loading");
      button.setAttribute("aria-busy", "true");
    }
    button.addEventListener("click", () => {
      if (button.disabled) return;
      this.emitEducationAction(surface, definition, card, action, {}, `${definition.id}_primary`);
    });
    footer.append(button);
    return footer;
  }

  emitEducationAction(surface, definition, card, action, context, sourceComponentId) {
    const resolved = objectRecord(resolveContext(action.context || {}, surface.dataModel));
    this.onEvent({
      version: "v0.9",
      action: {
        name: action.name,
        surfaceId: this.activeSurfaceId,
        sourceComponentId: safeId(sourceComponentId) || definition.id,
        timestamp: new Date().toISOString(),
        context: {
          ...resolved,
          ...objectRecord(context),
          card_id: card.id,
          card_type: card.type
        }
      }
    });
  }

  renderTextField(surface, definition) {
    const wrapper = document.createElement("label");
    wrapper.className = "a2ui-field";
    const label = document.createElement("span");
    label.textContent = String(definition.label || "输入");
    const input = definition.textFieldType === "longText" ? document.createElement("textarea") : document.createElement("input");
    const path = bindingPath(definition.value);
    const type = input instanceof HTMLInputElement ? inputType(definition.textFieldType) : "text";
    if (input instanceof HTMLInputElement) input.type = type;
    input.value = String(resolveBoundValue(definition.value, surface.dataModel) ?? "");
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      if (path) setPointer(surface.dataModel, path, input.value);
      this.emitTelemetry(definition, "input", {
        kind: definition.textFieldType === "number" ? "number" : "text",
        present: input.value.length > 0,
        length: input.value.length
      });
    });
    wrapper.append(label, input);
    return wrapper;
  }

  renderChoicePicker(surface, definition) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "a2ui-choice";
    const legend = document.createElement("legend");
    legend.textContent = String(definition.label || "请选择");
    const options = document.createElement("div");
    options.className = "a2ui-choice-options";
    const binding = definition.value || definition.selections;
    const path = bindingPath(binding);
    const current = resolveBoundValue(binding, surface.dataModel);

    for (const option of Array.isArray(definition.options) ? definition.options : []) {
      const optionLabel = document.createElement("label");
      optionLabel.className = "a2ui-choice-option";
      const input = document.createElement("input");
      const copy = document.createElement("span");
      input.type = "radio";
      input.name = `${this.activeSurfaceId}_${definition.id}`;
      input.value = String(option.value ?? "");
      input.checked = Array.isArray(current) ? current.includes(option.value) : current === option.value;
      copy.textContent = String(option.label ?? option.value ?? "");
      input.addEventListener("change", () => {
        if (!input.checked) return;
        if (path) setPointer(surface.dataModel, path, option.value);
        this.emitTelemetry(definition, "change", {
          kind: "choice",
          present: true,
          selection: String(option.label ?? option.value ?? "")
        });
      });
      optionLabel.append(input, copy);
      options.append(optionLabel);
    }

    fieldset.append(legend, options);
    return fieldset;
  }

  renderCheckBox(surface, definition) {
    const label = document.createElement("label");
    label.className = "a2ui-checkbox";
    const input = document.createElement("input");
    const copy = document.createElement("span");
    const path = bindingPath(definition.value);
    input.type = "checkbox";
    input.checked = Boolean(resolveBoundValue(definition.value, surface.dataModel));
    copy.textContent = String(definition.label || "确认");
    input.addEventListener("change", () => {
      if (path) setPointer(surface.dataModel, path, input.checked);
      this.emitTelemetry(definition, "change", {
        kind: "boolean",
        present: true,
        checked: input.checked
      });
    });
    label.append(input, copy);
    return label;
  }

  renderButton(surface, definition, stack, depth) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = definition.variant === "primary" ? "a2ui-button is-primary" : "a2ui-button";
    const child = definition.child ? this.renderComponent(surface, definition.child, stack, depth + 1) : null;
    if (child) button.append(child);
    else button.textContent = String(definition.label || "继续");
    button.addEventListener("click", () => {
      const event = definition.action?.event;
      if (!event?.name) {
        this.emitTelemetry(definition, "click", { kind: "button", present: true });
        return;
      }
      this.onEvent({
        version: "v0.9",
        action: {
          name: String(event.name),
          surfaceId: this.activeSurfaceId,
          sourceComponentId: definition.id,
          timestamp: new Date().toISOString(),
          context: resolveContext(event.context || {}, surface.dataModel)
        }
      });
    });
    return button;
  }

  emitTelemetry(definition, interaction, valueSummary) {
    this.onEvent({
      version: "v0.9",
      telemetry: {
        interaction,
        surfaceId: this.activeSurfaceId,
        componentId: definition.id,
        componentType: definition.component,
        label: String(definition.label || definition.id),
        valueSummary,
        timestamp: new Date().toISOString()
      }
    });
  }

  reportError(code, message) {
    this.onError({ version: "v0.9", error: { code, surfaceId: this.activeSurfaceId, message } });
  }
}

function normalizeEducationCard(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "EducationCard requires a card object" };
  }
  const id = safeText(input.id, 96);
  const type = safeText(input.type, 64);
  const version = safeText(input.version, 16);
  if (!id) return { ok: false, message: "EducationCard requires card.id" };
  if (version !== "1.0") {
    return { ok: false, message: `Unsupported EducationCard version: ${version || "missing"}` };
  }
  if (!SUPPORTED_EDUCATION_CARD_TYPES.has(type)) {
    return { ok: false, message: `Unsupported EducationCard type: ${type || "missing"}` };
  }

  return {
    ok: true,
    card: {
      id,
      type,
      version,
      meta: objectRecord(input.meta),
      props: objectRecord(input.props),
      state: objectRecord(input.state),
      actions: normalizeEducationActions(input.actions)
    }
  };
}

function educationCardFallback(message) {
  const element = document.createElement("section");
  element.className = "edu-card edu-card--unsupported";
  element.setAttribute("role", "status");
  const title = document.createElement("strong");
  title.textContent = "学习卡片暂不可用";
  const copy = document.createElement("p");
  copy.textContent = safeText(message, 160) || "请稍后重试";
  element.append(title, copy);
  return element;
}

function educationEmptyState(message) {
  const element = document.createElement("div");
  element.className = "edu-empty";
  element.setAttribute("role", "status");
  element.textContent = safeText(message, 160) || "暂无内容";
  return element;
}

function defaultEducationTitle(type) {
  const titles = {
    "compiler.status": "知识编译",
    "exam.progress": "考试进度",
    "exam.result": "考试结果",
    "knowledge.explanation": "知识讲解",
    "knowledge.mindmap": "知识结构",
    "language.grammar": "英语语法句型",
    "language.vocabulary": "英语单词",
    "media.image": "图像学习",
    "media.video": "视频学习",
    "oral.practice": "口语练习",
    "quiz.single-choice": "单选题"
  };
  return titles[type] || "学习卡片";
}

function educationTypeClass(type) {
  return safeText(type, 64).replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function normalizeEducationStatus(value) {
  const status = safeText(value, 32).toLowerCase();
  if (["loading", "pending", "processing", "compiling", "running"].includes(status)) return "loading";
  if (["correct", "success", "completed", "complete", "done", "compiled"].includes(status)) return "correct";
  if (["incorrect", "wrong", "failed", "failure", "error"].includes(status)) return "incorrect";
  if (["disabled", "locked"].includes(status)) return "disabled";
  return "";
}

function normalizeEducationResult(value) {
  const status = normalizeEducationStatus(value);
  if (status === "correct") return "correct";
  if (status === "incorrect") return "incorrect";
  return "";
}

function normalizeEducationActions(input) {
  if (!Array.isArray(input)) return objectRecord(input);
  const actions = input.filter(
    (item) => item && typeof item === "object" && !Array.isArray(item)
  );
  const normalized = { all: actions };
  const select = actions.find(
    (item) => firstText(item.type, item.name, item.event?.name) === "answer.select"
  );
  const primary = actions.find(
    (item) => firstText(item.type, item.name, item.event?.name) !== "answer.select"
  );
  if (select) normalized.select = select;
  if (primary) normalized.primary = primary;
  return normalized;
}

function findEducationAction(actions, name, value, excludeAnswerSelect = false) {
  const list = Array.isArray(actions?.all) ? actions.all : [];
  return list.find((item) => {
    const actionName = firstText(item.type, item.name, item.event?.name);
    if (excludeAnswerSelect && actionName === "answer.select") return false;
    if (name && actionName !== name) return false;
    if (value === undefined) return true;
    const payload = objectRecord(item.payload);
    const context = objectRecord(item.context);
    return sameChoiceValue(
      firstDefined(payload.value, payload.answer, context.value, context.answer),
      value
    );
  });
}

function normalizeQuizOptions(input) {
  return valueList(input)
    .map((item, index) => {
      if (item == null) return null;
      if (typeof item !== "object" || Array.isArray(item)) {
        const label = textFromValue(item);
        return label ? { value: item, label, description: "", disabled: false } : null;
      }
      const record = objectRecord(item);
      const label = firstText(record.label, record.text, record.title, record.value, `选项 ${index + 1}`);
      return {
        value: firstDefined(record.value, record.id, label),
        label,
        description: firstText(record.description, record.hint, record.subtitle),
        disabled: Boolean(record.disabled),
        action: record.action,
        context: objectRecord(record.context)
      };
    })
    .filter(Boolean);
}

function quizOptionMarker(index) {
  if (index >= 0 && index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

function quizStatusText(state, selectedValue, options) {
  const result =
    normalizeEducationResult(state.result || state.status) ||
    (typeof state.correct === "boolean" ? (state.correct ? "correct" : "incorrect") : "");
  if (result === "correct") return firstText(state.result_text, state.resultText, "回答正确");
  if (result === "incorrect") return firstText(state.result_text, state.resultText, "继续想一想");
  if (selectedValue !== undefined && selectedValue !== null && selectedValue !== "") {
    const selected = options.find((option) => sameChoiceValue(option.value, selectedValue));
    return selected ? `已选择：${selected.label}` : "已选择答案";
  }
  return "选择后会立即提交答案";
}

function sameChoiceValue(left, right) {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

export function deriveQuizOptionFeedback({
  optionValue,
  selectedValue,
  correctValue,
  result,
  revealResult
} = {}) {
  if (!revealResult) return "";
  const selected = sameChoiceValue(optionValue, selectedValue);
  const knownCorrect =
    correctValue !== undefined && sameChoiceValue(optionValue, correctValue);
  if (knownCorrect || (selected && result === "correct")) return "correct";
  if (selected) return "incorrect";
  return "";
}

function normalizeEducationAction(input, fallbackName = "", fallbackLabel = "") {
  if (typeof input === "string") {
    return {
      name: safeActionName(input, fallbackName),
      label: fallbackLabel,
      context: {},
      disabled: false,
      loading: false
    };
  }
  const record = objectRecord(input);
  const event = objectRecord(record.event);
  const payload = objectRecord(record.payload);
  return {
    name: safeActionName(firstText(record.type, record.name, event.name), fallbackName),
    label: firstText(record.label, record.title, event.label, fallbackLabel),
    context: {
      ...payload,
      ...objectRecord(event.context),
      ...objectRecord(record.context)
    },
    disabled: Boolean(record.disabled),
    loading: Boolean(record.loading)
  };
}

function safeActionName(value, fallback = "") {
  const candidate = safeText(value, 96);
  if (/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(candidate)) return candidate;
  const safeFallback = safeText(fallback, 96);
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(safeFallback) ? safeFallback : "";
}

function appendEducationCopy(parent, value, className = "") {
  const text = safeText(value, 6000);
  if (!text) return;
  const wrapper = document.createElement("div");
  if (className) wrapper.className = className;
  text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12)
    .forEach((part) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = part;
      wrapper.append(paragraph);
    });
  if (wrapper.childElementCount) parent.append(wrapper);
}

function educationSourceLine(input) {
  const sources = valueList(input)
    .map((source) => {
      const record = objectRecord(source);
      return firstText(
        record.label,
        record.title,
        record.name,
        record.citation,
        typeof source === "string" ? source : ""
      );
    })
    .filter(Boolean)
    .slice(0, 4);
  if (!sources.length) return null;
  const element = document.createElement("p");
  element.className = "edu-card__sources";
  element.textContent = `来源：${sources.join(" · ")}`;
  return element;
}

function normalizeMindmap(props) {
  const rootValue = firstDefined(props.root, props.center, props.topic);
  const rootRecord = objectRecord(rootValue);
  const rootLabel = firstText(
    rootRecord.label,
    rootRecord.title,
    rootRecord.text,
    typeof rootValue === "string" ? rootValue : "",
    props.title,
    "核心知识"
  );
  const explicitChildren = valueList(rootRecord.children);
  if (explicitChildren.length) {
    return normalizeNestedMindmapNode(
      { ...rootRecord, label: rootLabel },
      "mindmap_root",
      0
    );
  }

  const rawNodes = valueList(props.nodes || props.branches).slice(0, 50);
  if (!rawNodes.length) return rootLabel ? { id: "mindmap_root", label: rootLabel, children: [] } : null;
  const nodes = rawNodes
    .map((item, index) => {
      const record = objectRecord(item);
      const label = firstText(
        record.label,
        record.title,
        record.text,
        record.name,
        typeof item === "string" ? item : ""
      );
      if (!label) return null;
      return {
        id: firstText(record.id, `node_${index + 1}`),
        label,
        parentId: firstText(record.parent_id, record.parentId, record.parent),
        children: valueList(record.children)
      };
    })
    .filter(Boolean);
  const rootId = firstText(rootRecord.id, "mindmap_root");
  const byParent = new Map();
  nodes.forEach((node) => {
    const parentId = node.parentId || rootId;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(node);
  });

  const buildNode = (node, depth, seen) => {
    if (depth > 4 || seen.has(node.id)) return { id: node.id, label: node.label, children: [] };
    const nextSeen = new Set(seen);
    nextSeen.add(node.id);
    const nested = node.children
      .map((child, index) =>
        normalizeNestedMindmapNode(child, `${node.id}_child_${index + 1}`, depth + 1)
      )
      .filter(Boolean);
    const flat = (byParent.get(node.id) || []).map((child) =>
      buildNode(child, depth + 1, nextSeen)
    );
    return { id: node.id, label: node.label, children: [...nested, ...flat].slice(0, 12) };
  };
  const directChildren = (byParent.get(rootId) || [])
    .filter((node) => node.id !== rootId)
    .map((node) => buildNode(node, 1, new Set([rootId])));
  const orphaned = nodes
    .filter(
      (node) =>
        node.id !== rootId &&
        node.parentId &&
        !nodes.some((candidate) => candidate.id === node.parentId)
    )
    .map((node) => buildNode(node, 1, new Set([rootId])));
  return {
    id: rootId,
    label: rootLabel,
    children: [...directChildren, ...orphaned].slice(0, 16)
  };
}

function normalizeNestedMindmapNode(input, fallbackId, depth) {
  if (depth > 4) return null;
  if (typeof input !== "object" || input == null || Array.isArray(input)) {
    const label = textFromValue(input);
    return label ? { id: fallbackId, label, children: [] } : null;
  }
  const record = objectRecord(input);
  const label = firstText(record.label, record.title, record.text, record.name);
  if (!label) return null;
  const id = firstText(record.id, fallbackId);
  const children = valueList(record.children)
    .slice(0, 12)
    .map((child, index) =>
      normalizeNestedMindmapNode(child, `${id}_child_${index + 1}`, depth + 1)
    )
    .filter(Boolean);
  return { id, label, children };
}

function renderMindmapNode(node, depth, seen, siblingIndex) {
  const element = document.createElement("div");
  element.className = depth === 0 ? "edu-mindmap__root" : "edu-mindmap__branch";
  element.setAttribute("role", "treeitem");
  element.setAttribute("aria-level", String(depth + 1));
  element.dataset.mindmapDepth = String(depth);
  element.style.setProperty("--mindmap-delay", `${depth * 60 + siblingIndex * 20}ms`);
  const label = document.createElement("span");
  label.className = "edu-mindmap__node";
  label.textContent = safeText(node.label, 180);
  element.append(label);

  if (depth >= 4 || seen.has(node.id) || !node.children?.length) return element;
  const nextSeen = new Set(seen);
  nextSeen.add(node.id);
  const children = document.createElement("div");
  children.className = "edu-mindmap__children";
  children.setAttribute("role", "group");
  node.children.slice(0, 16).forEach((child, index) => {
    children.append(renderMindmapNode(child, depth + 1, nextSeen, index));
  });
  element.append(children);
  return element;
}

function lucideIcon(name) {
  const icon = document.createElement("i");
  icon.dataset.lucide = safeText(name, 48);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function safeMediaUrl(value) {
  const raw = safeText(value, 2048);
  if (!raw) return "";
  if (raw.startsWith("/assets/")) {
    try {
      const pathname = decodeURIComponent(raw.split(/[?#]/)[0]);
      if (pathname.split("/").includes("..")) return "";
    } catch {
      return "";
    }
    return raw;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function progressBlock(value, labelText) {
  const wrapper = document.createElement("div");
  wrapper.className = "edu-progress";
  const header = document.createElement("div");
  header.className = "edu-progress__label";
  const label = document.createElement("span");
  label.textContent = safeText(labelText, 180) || "进度";
  const percent = document.createElement("b");
  percent.textContent = `${formatNumber(value)}%`;
  header.append(label, percent);
  const progress = document.createElement("progress");
  progress.max = 100;
  progress.value = value;
  progress.textContent = `${formatNumber(value)}%`;
  wrapper.append(header, progress);
  return wrapper;
}

function educationMetrics(items) {
  const element = document.createElement("dl");
  element.className = "edu-metrics";
  items.slice(0, 6).forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = safeText(label, 48);
    const description = document.createElement("dd");
    description.textContent = safeText(value, 80);
    item.append(term, description);
    element.append(item);
  });
  return element;
}

function compilerStatus(value) {
  if (["compiled", "complete", "completed", "success", "done"].includes(value)) {
    return { key: "success", label: "编译完成", message: "知识内容已可用于教学", progress: 100 };
  }
  if (["failed", "failure", "error"].includes(value)) {
    return { key: "error", label: "编译失败", message: "请检查文件后重试", progress: 0 };
  }
  if (["processing", "compiling", "running", "extracting", "indexing"].includes(value)) {
    return { key: "loading", label: "正在编译", message: "正在整理知识结构", progress: 48 };
  }
  return { key: "pending", label: "等待编译", message: "文件已进入处理队列", progress: 0 };
}

function formatDuration(value) {
  if (typeof value === "string" && value.trim() && !Number.isFinite(Number(value))) {
    return safeText(value, 48);
  }
  const seconds = finiteNumber(value);
  if (seconds === null) return "";
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  if (hours) {
    return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
  }
  return [minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function optionalNumberText(value, suffix = "") {
  const number = finiteNumber(value);
  return number === null ? "" : `${formatNumber(number)}${suffix}`;
}

function finiteNumber(value) {
  if (value === "" || value == null || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value, fallback = 0) {
  const number = finiteNumber(value);
  return number === null ? fallback : Math.max(0, number);
}

function clampPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return 0;
  const normalized = number > 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, normalized));
}

function formatNumber(value) {
  const number = finiteNumber(value);
  if (number === null) return "0";
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function firstText(...values) {
  for (const value of values) {
    const text = safeText(value, 6000);
    if (text) return text;
  }
  return "";
}

function textFromValue(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return safeText(value, 600);
  }
  const record = objectRecord(value);
  return firstText(record.label, record.title, record.text, record.name, record.value);
}

function valueList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeText(value, limit = 600) {
  if (value == null || typeof value === "object") return "";
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);
}

function appendChild(parent, child) {
  if (child) parent.append(child);
}

function resolveBoundValue(value, model) {
  const path = bindingPath(value);
  return path ? getPointer(model, path) : value;
}

function resolveContext(value, model) {
  if (Array.isArray(value)) return value.map((item) => resolveContext(item, model));
  if (!value || typeof value !== "object") return value;
  if (typeof value.path === "string") return getPointer(model, value.path);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveContext(item, model)]));
}

function bindingPath(value) {
  return value && typeof value === "object" && typeof value.path === "string" ? value.path : "";
}

function getPointer(target, pointer) {
  if (!pointer || pointer === "/") return target;
  let current = target;
  for (const key of pointerKeys(pointer)) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function setPointer(target, pointer, value) {
  const keys = pointerKeys(pointer);
  if (!keys.length) return;
  let current = target;
  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || typeof current[key] !== "object") current[key] = {};
    current = current[key];
  });
  current[keys.at(-1)] = value;
}

function pointerKeys(pointer) {
  return String(pointer || "")
    .split("/")
    .slice(1)
    .map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function inputType(textFieldType) {
  if (textFieldType === "number") return "number";
  if (textFieldType === "date") return "date";
  if (textFieldType === "obscured") return "password";
  return "text";
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
}

function safeVariant(value) {
  return ["h1", "h2", "h3", "h4", "h5", "caption", "body"].includes(value) ? value : "body";
}
