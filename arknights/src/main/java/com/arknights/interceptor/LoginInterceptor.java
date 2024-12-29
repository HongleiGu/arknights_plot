package com.arknights.interceptor;

import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.ModelAndView;

import com.alibaba.fastjson.JSONObject;
import com.arknights.pojo.Result;
import com.arknights.utils.JwtUtils;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
public class LoginInterceptor implements HandlerInterceptor{

  @Override
  public boolean preHandle(
    HttpServletRequest request,
    HttpServletResponse response, 
    Object handler
    ) throws Exception {
    // 目标资源方法云清前调用,返回true则放行,返回false则不放行
    // System.out.println("preHandle");
    HttpServletRequest req = (HttpServletRequest) request;
    HttpServletResponse resp = (HttpServletResponse) response;
    String url = req.getRequestURL().toString();
    log.info("访问url: {}", url);

    // 判断是否是登录请求
    if (url.contains("login")){
      log.info("登录操作,放行");
      // chain.doFilter(request, response);
      return true;
    }

    // 获取令牌
    String jwt = req.getHeader("Authorization");
    log.info("接收到jwt令牌 {}", jwt);
    // 判断令牌是否合法
    log.info("{}",StringUtils.hasLength(jwt));
    if (!StringUtils.hasLength(jwt)){
      log.info("请求头为空,未登录");
      Result error = Result.error("NOT_LOGIN");
      // 手动转json,在拦截器中还没有接收成json
      String notLogin = JSONObject.toJSONString(error);
      resp.getWriter().write(notLogin);
      return false;
    }
    // 校验jwt令牌
    try{
      JwtUtils.parseJwt(jwt);
    }
    catch(Exception e){
      log.info("解析令牌失败");
      Result error = Result.error("NOT_LOGIN");
      // 手动转json,在拦截器中还没有接收成json
      String notLogin = JSONObject.toJSONString(error);
      resp.getWriter().write(notLogin);
      return false;
    }

    // 放行
    log.info("令牌合法,放行");
    return true;
    // return HandlerInterceptor.super.preHandle(request, response, handler);
  }

  @Override
  public void postHandle(
    HttpServletRequest request, 
    HttpServletResponse response, 
    Object handler,
      @Nullable ModelAndView modelAndView
    ) throws Exception {
    // 在目标资源方法运行后运行
    System.out.println("postHandle");
    HandlerInterceptor.super.postHandle(request, response, handler, modelAndView);
  }

  @Override
  public void afterCompletion(
    HttpServletRequest request, 
    HttpServletResponse response, 
    Object handler,
      @Nullable Exception ex
    ) throws Exception {
      // 视图渲染完毕之后运行, 最后才运行
    System.out.println("afterCompletion");
    HandlerInterceptor.super.afterCompletion(request, response, handler, ex);
  }
  
}
