import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  isReadonly,
  isShallow
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend,
  makeMap
} from '@vue/shared'
import { isRef } from './ref'
// From createGetter:
// To makeMap:
// Return From makeMap: 用于检查map中是否有对应key
// Return To createGetter: 检查map中是否有对应key，__proto__,__v_isRef,__isVue
const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // instrument identity-sensitive Array methods to account for possible reactive
  // values
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      const arr = toRaw(this) as any
      for (let i = 0, l = this.length; i < l; i++) {
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      const res = arr[key](...args)
      if (res === -1 || res === false) {
        // if that didn't work, run it again using raw values.
        return arr[key](...args.map(toRaw))
      } else {
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      pauseTracking()
      const res = (toRaw(this) as any)[key].apply(this, args)
      resetTracking()
      return res
    }
  })
  return instrumentations
}
// From get:
// Return To get: 返回get方法，内部会执行track方法创建依赖集合，收集依赖到依赖集合中
function createGetter(isReadonly = false, shallow = false) {
  // 返回get方法
  return function get(target: Target, key: string | symbol, receiver: object) {
    // 如果key已经是reactive，返回!isReadonly
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
      // 如果key已经是readonly，返回isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
      // 如果key是shallow，返回shallow
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return shallow
    } else if (
      // 用于给Set中屏蔽原型引起的更新(之后会细说)
      key === ReactiveFlags.RAW &&
      receiver ===
        (isReadonly
          ? shallow
            ? shallowReadonlyMap
            : readonlyMap
          : shallow
          ? shallowReactiveMap
          : reactiveMap
        ).get(target)
    ) {
      return target
    }
    // 判断target是否是数组
    // From createGetter:
    // To isArray:
    // Retrun From isArray: 返回Array.isArray 判断是否是数组类型
    const targetIsArray = isArray(target)
    // 如果不是只读并且 target是数组类型 并且key存在于arrayInstrumentations上
    // 那么返回定义在arrayInstrumentations上的方法 也就是重写的数组方法
    // From: createGetter:
    // To hasOwn:
    // Return From hasOwn: 判断对象是否有指定的属性
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      // 返回数组方法
      // From: createGetter:
      //todo To: arrayInstrumentations
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
    // 使用Reflect是为了第三个参数的this
    const res = Reflect.get(target, key, receiver)
    // 不应该在副作用函数与Symbol这类值之间建立响应联系，
    // 如果key的类型是symbol，不需要收集依赖，返回
    // From crateGetter:
    // To isSymbol:
    // Return From isSymbol: 判断是否是Symbol类型
    // To isNonTrackableKeys:
    // Return From isNonTrackableKeys: 判断是否是非跟踪类型 __proto__,__v_isRef,__isVue
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }
    // 如果不是只读，才需要收集依赖，建立响应联系
    if (!isReadonly) {
      // From createGetter:
      // To: track
      // Return From track: 创建依赖集合，trackEffects收集依赖
      track(target, TrackOpTypes.GET, key)
    }
    // 如果是shallow浅响应式，返回经过一次依赖收集的res
    if (shallow) {
      return res
    }
    // 如果是Ref，脱Ref
    // From createGetter:
    // To: isRef
    // Return From isRef: 判断r上是否有__v_isRef属性，判断是否是Ref
    if (isRef(res)) {
      // ref unwrapping - does not apply for Array + integer key.
      // ref unwrapping - 不适用于 Array + integer key。
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
      // 脱ref
      return shouldUnwrap ? res.value : res
    }
    // 如果是对象，根据readonly来决定怎么递归，深只读，深reactive
    // From createGetter:
    // To isObject:
    // Return From isObject: 判断是否是对象类型
    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      // 也将返回值转换为代理。 我们进行 isObject 检查
      // 这里是为了避免无效值警告。 还需要惰性访问只读
      // 并在此处进行反应以避免循环依赖。
      // From createGetter:
      //todo To: readonly
      return isReadonly ? readonly(res) : reactive(res)
    }
    // 最后返回res
    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)
// From set:
// Return To Set: 返回set方法，内部会触发依赖，执行相关联的副作用函数
function createSetter(shallow = false) {
  // 返回set方法
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 获取旧值
    let oldValue = (target as any)[key]
    // 如果是只读并且Ref并且新值不是Ref，返回false
    // From createSetter:
    // To isReadonly:
    // Return From isReadonly: 判断是否是只读类型 根据据value上是否有ReactiveFlags.IS_READONLY属性判断
    // To isRef: 
    // Return From isRef: 判断是否是Ref类型 根据value上是否有__v_isRef属性判断
    if (isReadonly(oldValue) && isRef(oldValue) && !isRef(value)) {
      return false
    }
    // 如果shallow是false(浅响应式)，并且新值不是只读
    if (!shallow && !isReadonly(value)) {
      // 如果新值也不是浅响应式
      // From createSetter:
      // To isShallow:
      // Return From isShallow: 判断是否是浅响应式 根据value上是否有ReactiveFlags.IS_SHALLOW属性判断
      if (!isShallow(value)) {
        // From createSetter:
        // To: toRaw
        // Return From toRaw: 返回原始的代理对象
        value = toRaw(value)
        oldValue = toRaw(oldValue)
      }
      // 如果target不是数组，并且老值是Ref并且新值不是Ref
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        // 直接把新值赋值给老值的value
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
      // 在浅模式下，无论是否反应，对象都按原样设置
    }

    const hadKey =
      // 如果target是数组，并且key是数字(索引)
      // From createSetter:
      // To isIntegerKey:
      // Return From isIntegerKey: 判断是否是数字索引
      isArray(target) && isIntegerKey(key)
        ? // 如果索引小于数组长度，代表没有新增，就是SET类型，如果不小于数组长度，代表新增了，就是ADD类型
          Number(key) < target.length
        : // 如果拥有对应的key，是SET类型，如果没有对应的key，代表要新增，就是ADD类型
          hasOwn(target, key)
    // 使用Reflect.set方法，receiver为了this
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    // target === toRaw(receiver)就说明receiver就是target的代理对象,此目的是为了屏蔽由原型引起的更新
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        // 如果没有hadkey为false，那么Trigger类型为ADD
        // From createSetter:
        // To: trigger
        // Return From trigger: 将相对应的副作用函数(effect)推入到deps数组中，然后triggerEffects去遍历执行副作用函数
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // From createSetter:
        // To hasChanged:
        // Return From hasChanged: 比较新值和旧值是否发生了变化，包含对 NaN的判断。
        // 如果新旧值发生了变化，就Trigger 类型为SET
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    // 返回Reflect.set方法的返回值
    return result
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

function ownKeys(target: object): (string | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}
// From createReactiveObject:
// Return To createReactiveObject: 返回如下方法
export const mutableHandlers: ProxyHandler<object> = {
  // To: createGetter
  // Return From createGetter: 返回get方法，内部会执行track方法创建依赖集合，收集依赖到依赖集合中
  get,
  // To: createSetter
  // Return From createSetter: 返回set方法，内部会执行trigger方法触发依赖，执行相关联的副作用函数
  set,
  deleteProperty,
  has,
  ownKeys
}
// From createReactiveObject:
// Return To createReactiveObject: 返回如下方法
export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}
// From createReactiveObject:
// To extend: 
// Return From extend: extend就是Object.assign方法
// Return To createReactiveObject: 返回如下方法
export const shallowReactiveHandlers = /*#__PURE__*/ extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
// From createReactiveObject:
// Return To createReactiveObject: 返回如下方法
export const shallowReadonlyHandlers = /*#__PURE__*/ extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
