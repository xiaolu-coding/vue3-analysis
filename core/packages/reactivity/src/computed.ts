import { DebuggerOptions, ReactiveEffect } from './effect'
import { Ref, trackRefValue, triggerRefValue } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'
import { Dep } from './dep'

declare const ComputedRefSymbol: unique symbol

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
  [ComputedRefSymbol]: true
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (...args: any[]) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}
// From computed:
export class ComputedRefImpl<T> {
  public dep?: Dep = undefined

  private _value!: T
  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  public _dirty = true
  public _cacheable: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean,
    isSSR: boolean
  ) {
    // 通过new ReactiveEffect创建effect副作用函数，第二个参数是scheduler
    this.effect = new ReactiveEffect(getter, () => {
      // 当值发生变化时，判断dirty，使用调度器将dirty重置为true
      if (!this._dirty) {
        // 如果dirty为false，则设置dirty为true
        this._dirty = true
        // 手动调用triggerRefValue 避免嵌套的effect
        triggerRefValue(this)
      }
    })
    // 给effect设置computed
    this.effect.computed = this
    // 给effect设置active 如果是ssr则为false，如果不是就是true
    this.effect.active = this._cacheable = !isSSR
    this[ReactiveFlags.IS_READONLY] = isReadonly
  }
  // value的getter
  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    // 计算的 ref 可能会被其他代理包裹，例如 只读（）
    // 通过toRaw获取原始的值
    const self = toRaw(this)
    // 手动调用trackRefValue，去收集依赖 避免嵌套的effect
    trackRefValue(self)
    // 判断dirty和_cacheable 只有脏了才计算值，
    if (self._dirty || !self._cacheable) {
      // 如果dirty为true或者_cacheable为false 代表脏了
      // 则设置dirty为false
      self._dirty = false
      // 执行self.effect.run()
      self._value = self.effect.run()!
    }
    // 返回value
    return self._value
  }
  // value的setter
  set value(newValue: T) {
    this._setter(newValue)
  }
}
// computed
export function computed<T>(
  getter: ComputedGetter<T>,
  debugOptions?: DebuggerOptions
): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions,
  isSSR = false
) {
  // getter
  let getter: ComputedGetter<T>
  // setter
  let setter: ComputedSetter<T>
  // From computed:
  // To isFunction:
  // Return From isFunction: 判断是否是function类型
  // 判断getterOrOptions是否是函数，如果是函数就是get，如果不是就是get和set
  const onlyGetter = isFunction(getterOrOptions)
  if (onlyGetter) {
    // 如果是函数,就将get函数赋值给getter
    getter = getterOrOptions
    // setter不用
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    // 如果不是函数
    // 将对象的get赋给getter
    getter = getterOrOptions.get
    // 将对象的set赋给setter
    setter = getterOrOptions.set
  }
  // 创建一个新的computedRefImpl对象
  // From computed:
  // To ComputedRefImpl:
  const cRef = new ComputedRefImpl(getter, setter, onlyGetter || !setter, isSSR)
  // DEV忽略
  if (__DEV__ && debugOptions && !isSSR) {
    cRef.effect.onTrack = debugOptions.onTrack
    cRef.effect.onTrigger = debugOptions.onTrigger
  }
  // 返回cRef对象
  return cRef as any
}
