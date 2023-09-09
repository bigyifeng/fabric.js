import type { IText } from '../../fabric';
import type { TModificationEvents } from '../EventTypeDefs';
import { Point } from '../Point';
import { CENTER, iMatrix } from '../constants';
import type { FabricObject } from '../shapes/Object/FabricObject';
import { invertTransform } from '../util/misc/matrix';
import { resolveOrigin } from '../util/misc/resolveOrigin';
import { FitContentLayout } from './LayoutStrategies/FitContentLayout';
import type { LayoutStrategy } from './LayoutStrategies/LayoutStrategy';
import type { LayoutContext, LayoutResult, StrictLayoutContext } from './types';

export class LayoutManager {
  private _firstLayoutDone = false;
  private _prevLayoutStrategy?: LayoutStrategy;

  strategy: LayoutStrategy;
  private _subscriptions: Map<FabricObject, VoidFunction[]>;

  constructor(strategy: LayoutStrategy = new FitContentLayout()) {
    this.strategy = strategy;
    this._subscriptions = new Map();
  }

  performLayout(context: LayoutContext) {
    if (!this._firstLayoutDone && context.type !== 'initialization') {
      //  reject layout requests before initialization layout
      return;
    }

    const strictContext: StrictLayoutContext = {
      strategy: this.strategy,
      prevStrategy: this._prevLayoutStrategy,
      strategyChange:
        !!this._prevLayoutStrategy &&
        this.strategy !== this._prevLayoutStrategy,
      ...context,
    };

    this.onBeforeLayout(strictContext);

    const layoutResult = this.getLayoutResult(strictContext);
    let bubblingContext: LayoutResult | undefined;

    if (layoutResult) {
      this.commitLayout(strictContext, layoutResult);
      bubblingContext = layoutResult;
    } else if (!this._firstLayoutDone) {
      const prevCenter = strictContext.target.getRelativeCenterPoint();
      bubblingContext = {
        prevCenter,
        nextCenter: prevCenter,
        offset: new Point(),
        result: {
          centerX: prevCenter.x,
          centerY: prevCenter.y,
          width: strictContext.target.width,
          height: strictContext.target.height,
        },
      };
    }

    this._firstLayoutDone = true;
    this.onAfterLayout(strictContext, bubblingContext);
    this._prevLayoutStrategy = strictContext.strategy;
  }

  /**
   * subscribe to object layout triggers
   */
  protected subscribe(context: StrictLayoutContext, object: FabricObject) {
    const { target } = context;
    this.unsubscribe(context, object);
    const disposers = [
      object.on('modified', (e) =>
        this.performLayout({
          trigger: 'modified',
          e: { ...e, target: object },
          type: 'object_modified',
          target,
        })
      ),
      ...(
        [
          'moving',
          'resizing',
          'rotating',
          'scaling',
          'skewing',
          'changed',
        ] as TModificationEvents[]
      ).map((key) =>
        object.on(key, (e) =>
          this.performLayout({
            trigger: key,
            e: { ...e, target: object },
            type: 'object_modifying',
            target,
          })
        )
      ),
      (object as IText).on('changed', (e) =>
        this.performLayout({
          trigger: 'text:changed',
          e: { ...e, target: object },
          type: 'object_modifying',
          target,
        })
      ),
    ];
    this._subscriptions.set(object, disposers);
  }

  /**
   * unsubscribe object layout triggers
   */
  protected unsubscribe(context: StrictLayoutContext, object: FabricObject) {
    (this._subscriptions.get(object) || []).forEach((d) => d());
  }

  protected onBeforeLayout(context: StrictLayoutContext) {
    const { target } = context;

    // handle layout triggers subscription
    if (context.type === 'initialization' || context.type === 'added') {
      context.targets.forEach((object) => this.subscribe(context, object));
    } else if (context.type === 'removed') {
      context.targets.forEach((object) => this.unsubscribe(context, object));
    }

    //  fire layout hook and event (event will fire only for layouts after initialization layout)
    target.onBeforeLayout({
      context,
    });
    target.fire('layout:before', {
      context,
    });
  }

  protected getLayoutResult(
    context: StrictLayoutContext
  ): Required<LayoutResult> | undefined {
    const { target } = context;
    const prevCenter =
      context.type === 'initialization'
        ? new Point()
        : target.getRelativeCenterPoint();
    const result = context.strategy.calcLayoutResult(
      context,
      target.getObjects()
    );
    if (!result) {
      return;
    }
    const nextCenter = new Point(result.centerX, result.centerY);
    const correction = new Point(
      result.correctionX ?? 0,
      result.correctionY ?? 0
    );
    const relativeCorrection = new Point(
      result.relativeCorrectionX ?? 0,
      result.relativeCorrectionY ?? 0
    );
    const offset =
      context.type === 'initialization' && context.objectsRelativeToGroup
        ? new Point()
        : prevCenter
            .subtract(nextCenter)
            .add(correction)
            .transform(
              // in `initialization` we do not account for target's transformation matrix
              context.type === 'initialization'
                ? iMatrix
                : invertTransform(target.calcOwnMatrix()),
              true
            )
            .add(relativeCorrection);
    return {
      result,
      prevCenter,
      nextCenter,
      offset,
    };
  }

  protected commitLayout(
    context: StrictLayoutContext,
    layoutResult: Required<LayoutResult>
  ) {
    const { target } = context;
    const {
      result: { width, height },
      prevCenter,
      nextCenter,
    } = layoutResult;
    // set dimensions
    target.set({ width, height });
    // layout descendants
    this.layoutObjects(context, layoutResult);
    //  set position
    // in `initialization` we do not account for target's transformation matrix
    if (context.type === 'initialization') {
      const origin = nextCenter.add(
        new Point(width, height).multiply(
          new Point(
            resolveOrigin(target.originX),
            resolveOrigin(target.originY)
          )
        )
      );
      target.set({ left: origin.x, top: origin.y });
    } else if (!nextCenter.eq(prevCenter)) {
      target.setPositionByOrigin(nextCenter, CENTER, CENTER);
    }
    // invalidate
    context.type !== 'initialization' && target.setCoords();
    target._set('dirty', true);
  }

  protected layoutObjects(
    context: StrictLayoutContext,
    layoutResult: Required<LayoutResult>
  ) {
    const { target } = context;
    //  adjust objects to account for new center
    (context.type !== 'initialization' || !context.objectsRelativeToGroup) &&
      target.forEachObject((object) => {
        object.group === target &&
          this.layoutObject(context, layoutResult, object);
      });
    // adjust clip path to account for new center
    context.strategy.shouldLayoutClipPath(context) &&
      target.clipPath &&
      !target.clipPath.absolutePositioned &&
      this.layoutObject(context, layoutResult, target.clipPath as FabricObject);
  }

  /**
   * @param {FabricObject} object
   * @param {Point} offset
   */
  protected layoutObject(
    context: StrictLayoutContext,
    { offset }: Required<LayoutResult>,
    object: FabricObject
  ) {
    object.setRelativeXY(object.getRelativeXY().add(offset));
  }

  protected onAfterLayout(
    context: StrictLayoutContext,
    layoutResult?: LayoutResult
  ) {
    const { target } = context;

    //  fire layout hook and event (event will fire only for layouts after initialization layout)
    target.onAfterLayout({
      context,
      result: layoutResult,
    });
    target.fire('layout', {
      context,
      result: layoutResult,
    });

    //  bubble
    if (target.group?.layoutManager) {
      //  add target to context#path
      (context.path || (context.path = [])).push(target);
      //  all parents should invalidate their layout
      const parent = target.group;
      parent.layoutManager.performLayout({
        ...context,
        target: parent,
      });
    }
  }
}
