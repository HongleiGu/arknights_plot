package com.arknights.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.arknights.interceptor.LoginInterceptor;
@Configuration
public class LoginConfig implements WebMvcConfigurer{

  @Autowired
  private LoginInterceptor loginInterceptor;

  @Override
  public void addInterceptors(
    InterceptorRegistry registry
    ) {
    registry.addInterceptor(loginInterceptor)
      .addPathPatterns("/**")
      .excludePathPatterns("/account/**")
      .excludePathPatterns("/account/identifyJwt")
      .excludePathPatterns("/insertPlots", "/insertChoices", "/insertOutcomes");
  }

}
