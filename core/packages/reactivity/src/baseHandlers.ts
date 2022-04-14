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
// Set(13) {…}
// [[Entries]]
// 0:
// value: Symbol(Symbol.asyncIterator)
// 1:
// value: Symbol(Symbol.hasInstance)
// 2:
// value: Symbol(Symbol.isConcatSpreadable)
// 3:
// value: Symbol(Symbol.iterator)
// 4:
// value: Symbol(Symbol.match)
// 5:
// value: Symbol(Symbol.matchAll)
// 6:
// value: Symbol(Symbol.replace)
// 7:
// value: Symbol(Symbol.search)
// 8:
// value: Symbol(Symbol.species)
// 9:
// value: Symbol(Symbol.split)
// 10:
// value: Symbol(Symbol.toPrimitive)
// 11:
// value: Symbol(Symbol.toStringTag)
// 12:
// value: Symbol(Symbol.unscopables)
// From has:
// Return To has: 13个内置的Symbol值的集合
const builtInSymbols = new Set(
  // 获取所有的Symbol值，有18个
  Object.getOwnPropertyNames(Symbol)
    // 将18个值Symbol化
    .map(key => (Symbol as any)[key])
    // 筛选出13个内置的Symbol值
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()
// From createGetter:
// Return To createGetter: // 返回一个包含了重写的几个数组方法'push', 'pop', 'shift', 'unshift', 'splice'，'includes', 'indexOf', 'lastIndexOf'的对象
function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
  // instrument identity-sensitive Array methods to account for possible reactive
  // values
  // includes indexOf lastIndexOf它们都根据给定的值返回查找结果
  ;(['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
    // this是代理数组
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // 获取原始数组
      const arr = toRaw(this) as any
      // 循环代理数组
      for (let i = 0, l = this.length; i < l; i++) {
        // 对原始数组的每个值进行track依赖收集
        track(arr, TrackOpTypes.GET, i + '')
      }
      // we run the method using the original args first (which may be reactive)
      // 执行includes indexOf lastIndexOf方法，将返回值赋值给res
      const res = arr[key](...args)
      // 如果返回值是-1或false，代表没找到
      if (res === -1 || res === false) {
        // if that didn't work, run it again using raw values.
        // 如果不起作用，请使用原始值再次运行。
        return arr[key](...args.map(toRaw))
      } else {
        // 如果找到了，返回方法的返回结果res
        return res
      }
    }
  })
  // instrument length-altering mutation methods to avoid length being tracked
  // which leads to infinite loops in some cases (#2137)
  // 会隐式修改数组长度的方法 当调用push时，会读取数组的length属性值，也会设置数组的length属性值，会导致两个独立的副作用函数互相影响，会导致栈溢出
  // 所以只要屏蔽这些方法对length属性值的读取，就可以了
  ;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
    // this是代理数组
    instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
      // From: createArrayInstrumentations
      // To pauseTracking:
      // Return From pauseTracking: 停止依赖收集
      pauseTracking()
      // toRaw获取原始数组，并执行相应方法 push pop shift unshift splice，将结果赋值给res
      const res = (toRaw(this) as any)[key].apply(this, args)
      // From: createArrayInstrumentations
      // To resetTracking:
      // Return From resetTracking: 重启依赖收集
      resetTracking()
      // 将执行结果res返回
      return res
    }
  })
  // 返回instrumentations对象，包含了重写的几个数组方法'push', 'pop', 'shift', 'unshift', 'splice'，'includes', 'indexOf', 'lastIndexOf'
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
    // From createGetter:
    // To isArray:
    // Retrun From isArray: 返回Array.isArray 判断是否是数组类型
    // 判断target是否是数组
    const targetIsArray = isArray(target)
    // From: createGetter:
    // To hasOwn:
    // Return From hasOwn: 判断对象是否有指定的属性
    // 如果不是只读并且 target是数组类型 并且key存在于arrayInstrumentations上
    // 那么返回定义在arrayInstrumentations上的方法 也就是重写的数组方法
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      // 返回数组方法
      // From: createGetter:
      //todo To: arrayInstrumentations
      // 例如: 当执行arr.includes其实执行的是arrayInstrumentations.includes 这样就实现了重写数组方法
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
    // 使用Reflect是为了第三个参数的this
    const res = Reflect.get(target, key, receiver)
    // From crateGetter:
    // To isSymbol:
    // Return From isSymbol: 判断是否是Symbol类型
    // To isNonTrackableKeys:
    // Return From isNonTrackableKeys: 判断是否是非跟踪类型 __proto__,__v_isRef,__isVue
    // 不应该在副作用函数与Symbol这类值之间建立响应联系，
    // 如果key的类型是symbol，不需要收集依赖，返回
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
    // From createGetter:
    // To: isRef
    // Return From isRef: 判断r上是否有__v_isRef属性，判断是否是Ref
    // 如果是Ref，脱Ref
    if (isRef(res)) {
      // ref unwrapping - does not apply for Array + integer key.
      // ref unwrapping - 不适用于 Array + integer key。
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
      // 脱ref
      return shouldUnwrap ? res.value : res
    }
    // From createGetter:
    // To isObject:
    // Return From isObject: 判断是否是对象类型
    // 如果是对象，根据readonly来决定怎么递归，深只读，深reactive
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
// From mutableHandlers:
// Return To mutableHandlers: 如果target有相应的key值，并且删除成功，就以DELETE类型执行trigger触发依赖，key为关联，并将删除的老值传过去，并返回deleteProperty的操作结果
function deleteProperty(target: object, key: string | symbol): boolean {
  // hasOwn target上是否有相应的key，有则ture，无则false
  const hadKey = hasOwn(target, key)
  // 获取key值赋值给oldValue
  const oldValue = (target as any)[key]
  // 执行Reflect.deleteProperty操作删除key属性，并将返回值返回给result
  const result = Reflect.deleteProperty(target, key)
  // 如果hadKey为true result为true，代表有相应的key并成功删除
  if (result && hadKey) {
    // 以DELETE类型执行trigger触发依赖，key为关联，并将删除的老值传过去
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  // 返回deleteProperty的操作结果
  return result
}
// From mutableHandlers:
// Return To mutableHandlers: 如果不是Symbol值，就以HAS类型执行track收集依赖，并返回has操作的结果(has操作来自 in操作符)
function has(target: object, key: string | symbol): boolean {
  // 根据key是否在target上查找，如果在，返回true，否则返回false
  const result = Reflect.has(target, key)
  // From has:
  // To: builtInSymbols
  // Return From builtInSymbols: 13个内置的Symbol值
  // 如果key不是Symbol类型 或者 key不在builtInSymbols集合上
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    // 以HAS操作进行track依赖收集，关联为key
    track(target, TrackOpTypes.HAS, key)
  }
  // 返回has操作的结果
  return result
}
// From mutableHandlers:
// Return To mutableHandlers: 以ITERATE类型执行track收集依赖，如果操作目标是数组，则使用length属性作为key建立关联，如果不是数组是对象，则使用ITERATE_KEY建立关联
function ownKeys(target: object): (string | symbol)[] {
  // 以ITERATE类型执行track收集依赖
  // 如果操作目标是数组，则使用length属性作为key建立关联，如果不是数组，则使用ITERATE_KEY建立关联
  // 对象时，删除和增加属性值都会影响for in循环，所以用ITERATE_KEY为key做关联
  // 但是数组不一样，数组添加新元素或者修改长度都会影响for in循环，而添加新元素和修改长度都是修改length属性，因此要用length属性为key建立关联
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  // 返回ownkeys的操作结果
  return Reflect.ownKeys(target)
}
// From createReactiveObject:
// Return To createReactiveObject: 返回包含get、set、deleteProperty、ownKeys、has方法的对象
export const mutableHandlers: ProxyHandler<object> = {
  // To: createGetter
  // Return From createGetter: 返回get方法，内部会执行track方法创建依赖集合，收集依赖到依赖集合中
  // get触发
  get,
  // To: createSetter
  // Return From createSetter: 返回set方法，内部会执行trigger方法触发依赖，执行相关联的副作用函数
  // set触发
  set,
  // To: deleteProperty:
  // Reutrn From deleteProperty: 如果target有相应的key值，并且删除成功，就以DELETE类型执行trigger触发依赖，key为关联，并将删除的老值传过去，并返回deleteProperty的操作结果
  // deleteProperty触发
  deleteProperty,
  // To: has
  // Return From has: 如果不是Symbol值，就以HAS类型执行track收集依赖，并返回has操作的结果(has操作来自 in操作符)
  // in 触发
  has,
  // To: ownKeys:
  // Retrun From ownKeys: 以ITERATE类型执行track收集依赖，如果操作目标是数组，则使用length属性作为key建立关联，如果不是数组是对象，则使用ITERATE_KEY建立关联
  // for in触发
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
